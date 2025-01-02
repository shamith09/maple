from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from dotenv import load_dotenv
import os
import uuid
from functools import wraps

INITAL_TTL = 5

load_dotenv()

app = Flask(__name__)
CORS(app)

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/coupon_finder')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

def get_user_id():
    user_id = request.headers.get('X-User-ID')
    if not user_id:
        return None  # This will trigger a 429 from the limiter
    return user_id

# Initialize limiter with custom key function
limiter = Limiter(
    app=app,
    key_func=get_user_id,
    default_limits=["10 per second"],
    storage_uri="memory://"
)

def require_user_id(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = request.headers.get('X-User-ID')
        if not user_id:
            return jsonify({'error': 'X-User-ID header is required'}), 401
        return f(*args, **kwargs)
    return decorated_function

class Website(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    domain = db.Column(db.String(255), unique=True, nullable=False)
    coupons = db.relationship('Coupon', backref='website', lazy=True)

class Coupon(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(50), nullable=False)
    website_id = db.Column(db.Integer, db.ForeignKey('website.id'), nullable=False)
    last_tested = db.Column(db.DateTime)
    discount_amount = db.Column(db.Float)
    is_percentage = db.Column(db.Boolean, default=False)  # True for percentage, False for dollar amount
    added_by = db.Column(db.String(255))
    ttl = db.Column(db.Integer, default=5)

class Analytics(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    total_savings = db.Column(db.Float, default=0.0)

# Initialize analytics if not exists
def init_analytics():
    with app.app_context():
        # Create tables if they don't exist
        db.create_all()
        
        analytics = Analytics.query.first()
        if not analytics:
            analytics = Analytics(total_savings=0.0)
            db.session.add(analytics)
            db.session.commit()

# Create tables and initialize analytics
with app.app_context():
    db.create_all()
    init_analytics()

@app.route('/api/user-id', methods=['GET'])
@limiter.limit("10 per second")
def generate_user_id():
    """Generate a new user ID for clients that don't have one"""
    return jsonify({'user_id': str(uuid.uuid4())})

@app.route('/api/websites', methods=['POST'])
@require_user_id
@limiter.limit("10 per second")
def add_website():
    data = request.json
    website = Website.query.filter_by(domain=data['domain']).first()
    if not website:
        website = Website(domain=data['domain'])
        db.session.add(website)
        db.session.commit()
    return jsonify({'id': website.id, 'domain': website.domain})

@app.route('/api/coupons', methods=['POST'])
@require_user_id
@limiter.limit("10 per second")
def add_coupon():
    data = request.json
    website = Website.query.filter_by(domain=data['domain']).first()
    if not website:
        website = Website(domain=data['domain'])
        db.session.add(website)
        db.session.commit()
    
    # Validate discount amount
    discount_amount = data.get('discount_amount')
    is_percentage = data.get('discount_type') == 'percent'
    
    if discount_amount is not None:
        try:
            discount_amount = float(discount_amount)
            if is_percentage and (discount_amount <= 0 or discount_amount > 100):
                return jsonify({'error': 'Percentage discount must be between 0 and 100'}), 400
            elif not is_percentage and discount_amount <= 0:
                return jsonify({'error': 'Dollar discount must be greater than 0'}), 400
        except ValueError:
            return jsonify({'error': 'Invalid discount amount'}), 400
    
    coupon = Coupon(
        code=data['code'],
        website_id=website.id,
        added_by=request.headers.get('X-User-ID'),
        discount_amount=discount_amount,
        is_percentage=is_percentage,
        ttl=INITAL_TTL
    )
    db.session.add(coupon)
    db.session.commit()
    return jsonify({'message': 'Coupon added successfully'})

@app.route('/api/coupons/<domain>', methods=['GET', 'PUT'])
@require_user_id
@limiter.limit("10 per second")
def handle_coupons(domain):
    website = Website.query.filter_by(domain=domain).first()
    if not website:
        return jsonify({'error': 'Website not found'}), 404

    if request.method == 'GET':
        coupons = Coupon.query.filter_by(website_id=website.id).filter(Coupon.ttl > 0).all()
        return jsonify({
            'coupons': [{
                'id': c.id,
                'code': c.code, 
                'discount_amount': c.discount_amount,
                'discount_type': 'percent' if c.is_percentage else 'dollar',
                'ttl': c.ttl
            } for c in coupons]
        })
    
    elif request.method == 'PUT':
        data = request.json
        coupon = db.session.get(Coupon, data['id'])
        if not coupon or coupon.website_id != website.id:
            return jsonify({'error': 'Coupon not found'}), 404
        
        # Handle TTL updates
        if 'worked' in data:
            if data['worked']:
                coupon.ttl = INITAL_TTL  # Reset TTL if code worked
            else:
                coupon.ttl = max(0, coupon.ttl - 1)  # Decrement TTL, minimum 0
                if coupon.ttl == 0:
                    db.session.delete(coupon)  # Remove coupon if TTL reaches 0
        
        # Handle discount amount updates
        if 'actual_discount' in data:
            coupon.discount_amount = round(float(data['actual_discount']), 1)  # Round to 1 decimal place
            coupon.is_percentage = True  # Always store as percentage
        
        db.session.commit()
        return jsonify({
            'message': 'Coupon updated successfully',
            'ttl': coupon.ttl,
            'discount_amount': coupon.discount_amount,
            'discount_type': 'percent' if coupon.is_percentage else 'dollar'
        })

@app.route('/api/analytics/savings', methods=['POST'])
@limiter.limit('60/minute')
def track_savings():
    if not request.headers.get('X-User-ID'):
        return jsonify({'error': 'X-User-ID header is required'}), 401
        
    data = request.get_json()
    if not data or 'amount_saved' not in data:
        return jsonify({'error': 'amount_saved is required'}), 400
        
    try:
        amount = float(data['amount_saved'])
        if amount <= 0:
            return jsonify({'error': 'amount_saved must be positive'}), 400
            
        analytics = Analytics.query.first()
        if not analytics:
            analytics = Analytics(total_savings=amount)
        else:
            analytics.total_savings = round(analytics.total_savings + amount, 2)
            
        db.session.commit()
        return jsonify({'success': True, 'total_savings': analytics.total_savings})
    except ValueError:
        return jsonify({'error': 'Invalid amount_saved value'}), 400

@app.route('/api/analytics/savings', methods=['GET'])
def get_savings():
    analytics = Analytics.query.first()
    if not analytics:
        return jsonify({'total_savings': 0.0})
    return jsonify({'total_savings': round(analytics.total_savings, 2)})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(port=os.getenv("PORT"), host="0.0.0.0")