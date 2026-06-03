const express = require("express");
const { Pool } = require("pg");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "Rock@123";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

async function initDB(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sunny_matta_contributions (
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
}

function formatINR(v){
  return "₹" + Number(v || 0).toLocaleString("en-IN");
}

function safe(v){
  return String(v || "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

app.get("/contributors", async(req,res)=>{
  const result = await pool.query(`
    SELECT name, company, city 
    FROM sunny_matta_contributions 
    WHERE approved = TRUE 
    ORDER BY id DESC
  `);
  res.json(result.rows);
});

app.post("/submit", async(req,res)=>{
  const {name, company, city, mobile, amount} = req.body;

  await pool.query(`
    INSERT INTO sunny_matta_contributions
    (name, company, city, mobile, amount, approved)
    VALUES ($1,$2,$3,$4,$5,FALSE)
  `,[name, company, city, mobile, amount]);

  res.send(`
  <div style="font-family:Arial;text-align:center;padding:30px">
    <h2>Thank You</h2>
    <p>Your details submitted successfully.</p>
    <p>Aapki payment approve hone ke baad aapka naam contributors list me show ho jayega.</p>
    <p><b>Confirmation ke liye sampark kare: +91 8851235015</b></p>
    <a href="/">Back to Form</a>
  </div>
  `);
});

app.get("/admin", async(req,res)=>{
  const {user, pass} = req.query;

  if(user !== ADMIN_USER || pass !== ADMIN_PASS){
    return res.send(`
    <div style="font-family:Arial;max-width:400px;margin:50px auto;text-align:center">
      <h2>Admin Login</h2>
      <form>
        <input name="user" placeholder="Username" style="width:100%;padding:12px;margin:8px"><br>
        <input name="pass" type="password" placeholder="Password" style="width:100%;padding:12px;margin:8px"><br>
        <button style="padding:12px 30px">Login</button>
      </form>
    </div>
    `);
  }

  const data = await pool.query(`
    SELECT * FROM sunny_matta_contributions ORDER BY id DESC
  `);

  const stats = await pool.query(`
    SELECT 
    COALESCE(SUM(CASE WHEN approved THEN amount ELSE 0 END),0) total,
    COUNT(*) FILTER (WHERE approved = TRUE) approved_count,
    COUNT(*) FILTER (WHERE approved = FALSE) pending_count
    FROM sunny_matta_contributions
  `);

  const rows = data.rows.map((i,n)=>`
    <tr>
      <td>${n+1}</td>
      <td>${safe(i.name)}</td>
      <td>${safe(i.company)}</td>
      <td>${safe(i.city)}</td>
      <td>${safe(i.mobile)}</td>

      <td>
        <form method="POST" action="/edit-amount">
          <input type="hidden" name="id" value="${i.id}">
          <input type="hidden" name="user" value="${user}">
          <input type="hidden" name="pass" value="${pass}">
          <input name="amount" value="${i.amount}" style="width:80px;text-align:center">
          <button>Save</button>
        </form>
      </td>

      <td>${i.approved ? "Approved" : "Pending"}</td>

      <td>
        ${i.approved ? "" : `
        <form method="POST" action="/approve">
          <input type="hidden" name="id" value="${i.id}">
          <input type="hidden" name="user" value="${user}">
          <input type="hidden" name="pass" value="${pass}">
          <button>Approve</button>
        </form>`}
      </td>

      <td>
        <form method="POST" action="/delete">
          <input type="hidden" name="id" value="${i.id}">
          <input type="hidden" name="user" value="${user}">
          <input type="hidden" name="pass" value="${pass}">
          <button style="background:red;color:white">Delete</button>
        </form>
      </td>
    </tr>
  `).join("");

  res.send(`
  <html>
  <head>
  <style>
  body{font-family:Arial;background:#f4f4f4;padding:20px;text-align:center}
  .card{background:white;padding:20px;border-radius:12px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;background:white}
  th,td{border:1px solid #ddd;padding:8px;text-align:center}
  th{background:#222;color:white}
  button{padding:6px 10px;border:0;background:#245b35;color:white;border-radius:5px}
  </style>
  </head>
  <body>

  <div class="card">
    <h2>Sunny Matta Contribution Admin</h2>
    <h3>Total Approved Amount: ${formatINR(stats.rows[0].total)}</h3>
    <p>Approved: ${stats.rows[0].approved_count} | Pending: ${stats.rows[0].pending_count}</p>
    <a href="/download-excel?user=${user}&pass=${pass}">
      <button>Download Excel</button>
    </a>
  </div>

  <table>
    <tr>
      <th>S.No</th>
      <th>Name</th>
      <th>Company</th>
      <th>City</th>
      <th>Mobile</th>
      <th>Amount Edit</th>
      <th>Status</th>
      <th>Approve</th>
      <th>Delete</th>
    </tr>
    ${rows}
  </table>

  </body>
  </html>
  `);
});

app.post("/approve", async(req,res)=>{
  const {id,user,pass} = req.body;
  await pool.query("UPDATE sunny_matta_contributions SET approved=TRUE WHERE id=$1",[id]);
  res.redirect(`/admin?user=${user}&pass=${pass}`);
});

app.post("/edit-amount", async(req,res)=>{
  const {id,amount,user,pass} = req.body;
  await pool.query("UPDATE sunny_matta_contributions SET amount=$1 WHERE id=$2",[amount,id]);
  res.redirect(`/admin?user=${user}&pass=${pass}`);
});

app.post("/delete", async(req,res)=>{
  const {id,user,pass} = req.body;
  await pool.query("DELETE FROM sunny_matta_contributions WHERE id=$1",[id]);
  res.redirect(`/admin?user=${user}&pass=${pass}`);
});

app.get("/download-excel", async(req,res)=>{
  const {user,pass} = req.query;
  if(user !== ADMIN_USER || pass !== ADMIN_PASS) return res.send("Unauthorized");

  const result = await pool.query(`
    SELECT name, company, city, mobile, amount, approved, created_at
    FROM sunny_matta_contributions ORDER BY id ASC
  `);

  const excelData = [
    ["Name","Company","City","Mobile","Amount","Status","Date"],
    ...result.rows.map(i=>[
      i.name,i.company,i.city,i.mobile,Number(i.amount),
      i.approved ? "Approved" : "Pending",
      i.created_at
    ])
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  XLSX.utils.book_append_sheet(wb,ws,"Contributions");

  const buffer = XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
  res.setHeader("Content-Disposition","attachment; filename=Sunny_Matta_Contribution.xlsx");
  res.send(buffer);
});

initDB().then(()=>{
  app.listen(PORT,()=>console.log("Server running on " + PORT));
});
