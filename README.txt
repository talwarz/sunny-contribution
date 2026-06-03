Sunny Contribution Final Version

Folder upload structure:
sunny-contribution
- server.js
- package.json
- public/
  - index.html
  - qr.png
  - sunny-matta.png

Before upload:
Replace public/qr.png with your real bank/UPI QR image.

Render setup:
1. Upload these files to GitHub repo: sunny-contribution
2. Render > New + > PostgreSQL
3. Database name: sunny-contribution-db
4. Copy Internal Database URL
5. Render > New + > Web Service
6. Connect GitHub repo: sunny-contribution
7. Settings:
   Environment: Node
   Build Command: npm install
   Start Command: npm start
8. Add Environment Variables:
   DATABASE_URL = your Internal Database URL
   ADMIN_USER = admin
   ADMIN_PASS = Rock@123
9. Click Deploy.

Links:
Form: https://your-render-url.onrender.com
Admin: https://your-render-url.onrender.com/admin

Admin login:
Username: admin
Password: Rock@123

Workflow:
User submits details -> entry is Pending.
Admin opens dashboard -> clicks Approve.
After approval, contributor name/company/city shows on public page.
Excel includes mobile, amount, status, date.
