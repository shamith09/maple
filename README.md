# Maple

<img src="https://savewithmaple.vercel.app/maple.png" alt="Maple Logo" 
  style="height: 32px; vertical-align: middle;">

An open-source alternative to PayPal Honey that automatically finds and applies the best coupon codes while you shop, without collecting your data or stealing money from affiliate links.

## Features

- 🔒 **Privacy First**: Unlike other extensions, we don't track your shopping habits or sell your data to advertisers
- 💰 **No Affiliate Stealing**: We don't make money from your purchases or show ads in the extension
- ⚡ **Lightning Fast**: Instantly tests coupon codes in the background without slowing down your shopping experience
- 🌐 **Community Driven**: Codes are crowdsourced by the community - when you add working codes, you help everyone save money
- 🔄 **Auto-Cleanup**: Expired or invalid codes are automatically detected and removed to keep the database fresh

## How It Works

1. Maple runs in the background while you shop
2. Automatically detects when you reach a checkout page
3. Tests available coupon codes in milliseconds
4. Applies the best discount automatically
5. Allows you to contribute new working codes to help others

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. Run the backend server:
   ```bash
   python app.py
   ```
4. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension` directory

Or install directly from the Chrome Web Store (coming soon).

## Support Maple

While this extension is completely free and ad-free, you can support its development by:

- ⭐ Starring this repository
- 🐛 Reporting bugs and suggesting features
- 💻 Contributing code improvements
- ☕ [Buying us a coffee](https://www.buymeacoffee.com/maple)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is open source and available under the BSD 3-Clause License.

## Acknowledgments

- Built with Flask and SQLAlchemy for the backend
- Chrome Extension APIs for the frontend
- Community contributors who help maintain the coupon database
