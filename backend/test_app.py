import unittest
from app import app, db
import json


class TestApp(unittest.TestCase):
    def setUp(self):
        # Configure test database
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["TESTING"] = True
        self.client = app.test_client()

        # Create tables
        with app.app_context():
            db.create_all()

        # Create test user ID
        response = self.client.get("/api/user-id")
        self.user_id = json.loads(response.data)["user_id"]
        self.headers = {"X-User-ID": self.user_id}

    def tearDown(self):
        # Clean up database
        with app.app_context():
            db.session.remove()
            db.drop_all()

    def test_get_user_id(self):
        response = self.client.get("/api/user-id")
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue("user_id" in data)
        self.assertTrue(isinstance(data["user_id"], str))

    def test_missing_user_id(self):
        # Test endpoint without user ID
        response = self.client.post("/api/websites", json={"domain": "test.com"})
        self.assertEqual(response.status_code, 401)

        # Test with invalid user ID
        response = self.client.post(
            "/api/websites", headers={"X-User-ID": ""}, json={"domain": "test.com"}
        )
        self.assertEqual(response.status_code, 401)

    def test_add_website(self):
        # Test adding new website
        response = self.client.post(
            "/api/websites", headers=self.headers, json={"domain": "test.com"}
        )
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["domain"], "test.com")

        # Test adding duplicate website
        response = self.client.post(
            "/api/websites", headers=self.headers, json={"domain": "test.com"}
        )
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["domain"], "test.com")

    def test_add_coupon(self):
        # Test adding valid coupon with percentage discount
        response = self.client.post(
            "/api/coupons",
            headers=self.headers,
            json={
                "domain": "test.com",
                "code": "TEST20",
                "discount_amount": 20,
                "discount_type": "percent",
            },
        )
        self.assertEqual(response.status_code, 200)

        # Test adding invalid percentage discount
        response = self.client.post(
            "/api/coupons",
            headers=self.headers,
            json={
                "domain": "test.com",
                "code": "TEST150",
                "discount_amount": 150,
                "discount_type": "percent",
            },
        )
        self.assertEqual(response.status_code, 400)

        # Test adding valid dollar discount
        response = self.client.post(
            "/api/coupons",
            headers=self.headers,
            json={
                "domain": "test.com",
                "code": "SAVE10",
                "discount_amount": 10,
                "discount_type": "dollar",
            },
        )
        self.assertEqual(response.status_code, 200)

        # Test adding invalid dollar discount
        response = self.client.post(
            "/api/coupons",
            headers=self.headers,
            json={
                "domain": "test.com",
                "code": "INVALID",
                "discount_amount": -10,
                "discount_type": "dollar",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_get_coupons(self):
        # Add test coupon
        self.client.post(
            "/api/coupons",
            headers=self.headers,
            json={
                "domain": "test.com",
                "code": "TEST20",
                "discount_amount": 20,
                "discount_type": "percent",
            },
        )

        # Test getting coupons for domain
        response = self.client.get("/api/coupons/test.com", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue("coupons" in data)
        self.assertEqual(len(data["coupons"]), 1)
        self.assertEqual(data["coupons"][0]["code"], "TEST20")

        # Test getting coupons for non-existent domain
        response = self.client.get("/api/coupons/nonexistent.com", headers=self.headers)
        self.assertEqual(response.status_code, 404)

    def test_update_coupon(self):
        # Add test coupon
        self.client.post(
            "/api/coupons",
            headers=self.headers,
            json={
                "domain": "test.com",
                "code": "TEST20",
                "discount_amount": 20,
                "discount_type": "percent",
            },
        )

        # Get coupon ID
        response = self.client.get("/api/coupons/test.com", headers=self.headers)
        coupon_id = json.loads(response.data)["coupons"][0]["id"]

        # Test updating TTL when code works
        response = self.client.put(
            f"/api/coupons/test.com",
            headers=self.headers,
            json={"id": coupon_id, "worked": True, "actual_discount": 22.5},
        )
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["discount_amount"], 22.5)
        self.assertEqual(data["discount_type"], "percent")

        # Test decrementing TTL when code doesn't work
        response = self.client.put(
            f"/api/coupons/test.com",
            headers=self.headers,
            json={"id": coupon_id, "worked": False},
        )
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["ttl"], 4)  # TTL should be decremented

    def test_rate_limiting(self):
        # Test rate limiting by making many requests quickly
        responses = []
        for _ in range(15):  # Try 15 requests (more than our 10/sec limit)
            response = self.client.post(
                "/api/websites", headers=self.headers, json={"domain": "test.com"}
            )
            responses.append(response.status_code)

        # At least some requests should be rate limited (429)
        self.assertTrue(429 in responses)


if __name__ == "__main__":
    unittest.main()
