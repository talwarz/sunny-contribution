const express = require("express");
const { Pool } = require("pg");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "Rock@123";
const CONTACT_NUMBER = "+91 8851235015";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contributions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      city TEXT NOT NULL,
      mobile TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      approved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS mobile TEXT;`);
  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;`);
}

function formatINR(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

app.get("/contributors", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name, company, city
      FROM contributions
      WHERE approved = TRUE
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
});

app.post("/submit", async (req, res) => {
  try {
    const { name, company, city, mobile, amount } = req.body;

    if (!name || !company || !city || !mobile || !amount) {
      return res.status(400).send("All fields are required.");
    }

    if (!/^[0-9]{10}$/.test(String(mobile).trim())) {
      return res.status(400).send("Please enter valid 10 digit mobile number.");
    }

    const amountNumber = Number(amount);
    if (Number.isNaN(amountNumber) || amountNumber <= 0) {
      return res.status(400).send("Please enter valid amount.");
    }

    await pool.query(
      `INSERT INTO contributions (name, company, city, mobile, amount, approved)
       VALUES ($1, $2, $3, $4, $5, FALSE)`,
      [name.trim(), company.trim(), city.trim(), mobile.trim(), amountNumber]
    );

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Thank You</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body{font-family:Arial;background:#f7f7f7;margin:0;padding:20px;text-align:center}
          .box{max-width:480px;margin:auto;background:white;padding:30px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.08)}
          h2{color:#24613b}
          a{display:inline-block;margin-top:15px;background:#24613b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none}
          .contact{font-size:20px;font-weight:bold;color:#111}
        </style>
      </head>
      <body>
        <div class="box">
          <h2>Thank You</h2>
          <p>Your details have been submitted successfully.</p>
          <p>Aapki payment approve hone ke baad aapka naam contributors list me show ho jayega.</p>
          <p>Confirmation ke liye sampark kare:</p>
          <p class="contact">${CONTACT_NUMBER}</p>
          <a href="/">Back to Form</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error. Please try again.");
  }
});

app.get("/admin", async (req, res) => {
  try {
    const { user, pass } = req.query;

    if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Admin Login</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body{font-family:Arial;background:#f4f4f4;padding:20px}
            .box{max-width:420px;margin:auto;background:white;padding:25px;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.08)}
            input,button{width:100%;box-sizing:border-box;padding:12px;margin:8px 0;border-radius:8px;border:1px solid #ccc;font-size:16px}
            button{background:#111;color:#fff;border:0;cursor:pointer}
          </style>
        </head>
        <body>
          <div class="box">
            <h2>Admin Login</h2>
            <form method="GET" action="/admin">
              <input name="user" placeholder="Username" required>
              <input name="pass" type="password" placeholder="Password" required>
              <button type="submit">Login</button>
            </form>
          </div>
        </body>
        </html>
      `);
    }

    const result = await pool.query(`
      SELECT id, name, company, city, mobile, amount, approved,
      created_at AT TIME ZONE 'Asia/Kolkata' AS created_at_ist
      FROM contributions
      ORDER BY id DESC
    `);

    const totalResult = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN approved = TRUE THEN amount ELSE 0 END),0) AS approved_total,
        COUNT(*) FILTER (WHERE approved = TRUE) AS approved_count,
        COUNT(*) FILTER (WHERE approved = FALSE) AS pending_count
      FROM contributions
    `);

    const stats = totalResult.rows[0];

    const rows = result.rows.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.company)}</td>
        <td>${escapeHtml(item.city)}</td>
        <td>${escapeHtml(item.mobile)}</td>
        <td>${formatINR(item.amount)}</td>
        <td>${item.approved ? "<b style='color:green'>Approved</b>" : "<b style='color:#b45309'>Pending</b>"}</td>
        <td>${new Date(item.created_at_ist).toLocaleString("en-IN")}</td>
        <td>
          ${item.approved ? "" : `
            <form method="POST" action="/approve" style="margin:0">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="user" value="${escapeHtml(user)}">
              <input type="hidden" name="pass" value="${escapeHtml(pass)}">
              <button>Approve</button>
            </form>
          `}
        </td>
      </tr>
    `).join("");

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sunny Matta Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body{font-family:Arial;background:#f4f4f4;margin:0;padding:20px}
          .wrap{max-width:1200px;margin:auto}
          .card{background:#fff;padding:22px;border-radius:14px;margin-bottom:18px;box-shadow:0 6px 20px rgba(0,0,0,.08)}
          .stats{display:flex;gap:15px;flex-wrap:wrap;text-align:center}
          .stat{flex:1;min-width:220px;background:#153f28;color:white;padding:20px;border-radius:12px}
          .stat h3{margin:0;font-size:15px;font-weight:400;opacity:.8}
          .stat p{margin:8px 0 0;font-size:30px;font-weight:700}
          a.btn{display:inline-block;background:#0b7a34;color:#fff;padding:12px 16px;border-radius:8px;text-decoration:none;margin-top:10px}
          table{width:100%;border-collapse:collapse;background:white;font-size:14px}
          th,td{border-bottom:1px solid #ddd;padding:9px;text-align:center}
          th{background:#222;color:white}
          button{background:#0b7a34;color:#fff;border:0;padding:8px 12px;border-radius:6px;cursor:pointer}
          .scroll{overflow-x:auto}
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h2 style="text-align:center">Sunny Matta Contribution Dashboard</h2>
            <div class="stats">
              <div class="stat"><h3>Approved Total Amount</h3><p>${formatINR(stats.approved_total)}</p></div>
              <div class="stat"><h3>Approved Contributors</h3><p>${stats.approved_count}</p></div>
              <div class="stat"><h3>Pending Approvals</h3><p>${stats.pending_count}</p></div>
            </div>
            <div style="text-align:center">
              <a class="btn" href="/download-excel?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}">Download Excel</a>
            </div>
          </div>

          <div class="card">
            <h3 style="text-align:center">All Entries</h3>
            <div class="scroll">
              <table>
                <tr>
                  <th>No.</th><th>Name</th><th>Company</th><th>City</th><th>Mobile</th><th>Amount</th><th>Status</th><th>Date</th><th>Action</th>
                </tr>
                ${rows || `<tr><td colspan="9">No entries yet.</td></tr>`}
              </table>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send("Admin error.");
  }
});

app.post("/approve", async (req, res) => {
  const { id, user, pass } = req.body;
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) return res.status(401).send("Unauthorized");

  await pool.query("UPDATE contributions SET approved = TRUE WHERE id = $1", [id]);
  res.redirect(`/admin?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`);
});

app.get("/download-excel", async (req, res) => {
  try {
    const { user, pass } = req.query;
    if (user !== ADMIN_USER || pass !== ADMIN_PASS) return res.status(401).send("Unauthorized");

    const result = await pool.query(`
      SELECT name, company, city, mobile, amount, approved,
      created_at AT TIME ZONE 'Asia/Kolkata' AS created_at_ist
      FROM contributions ORDER BY id ASC
    `);

    const totalResult = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM contributions WHERE approved = TRUE");
    const total = totalResult.rows[0].total;

    const excelData = [
      ["Name", "Company Name", "City", "Mobile", "Amount", "Status", "Date & Time"],
      ...result.rows.map(item => [
        item.name, item.company, item.city, item.mobile,
        Number(item.amount), item.approved ? "Approved" : "Pending",
        new Date(item.created_at_ist).toLocaleString("en-IN")
      ]),
      [],
      ["APPROVED TOTAL", "", "", "", Number(total), "", ""]
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    ws["!cols"] = [{wch:25},{wch:28},{wch:18},{wch:15},{wch:14},{wch:12},{wch:24}];
    XLSX.utils.book_append_sheet(wb, ws, "Contributions");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", "attachment; filename=Sunny_Matta_Contribution.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).send("Excel download error.");
  }
});

initDB().then(() => {
  app.listen(PORT, () => console.log("Server running on port " + PORT));
}).catch((error) => {
  console.error("Database connection failed:", error);
  process.exit(1);
});
