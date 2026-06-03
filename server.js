const express = require("express");
const { Pool } = require("pg");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "Rock@123";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS sunny_matta_contributions (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT NOT NULL,
    city TEXT NOT NULL,
    mobile TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    approved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );`);
}

function formatINR(v){ return "₹" + Number(v || 0).toLocaleString("en-IN"); }
function safe(v){ return String(v || "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
function auth(user, pass){ return user === ADMIN_USER && pass === ADMIN_PASS; }

app.get("/contributors", async(req,res)=>{
  const result = await pool.query(`SELECT name, company, city FROM sunny_matta_contributions WHERE approved = TRUE ORDER BY id DESC`);
  res.json(result.rows);
});

app.get("/public-stats", async(req,res)=>{
  const result = await pool.query(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM sunny_matta_contributions WHERE approved = TRUE`);
  res.json({ total:Number(result.rows[0].total), totalFormatted:formatINR(result.rows[0].total), count:Number(result.rows[0].count) });
});

app.post("/submit", async(req,res)=>{
  const {name, company, city, mobile, amount} = req.body;
  if(!name || !company || !city || !mobile || !amount) return res.status(400).send("All fields are required.");
  if(!/^[0-9]{10}$/.test(String(mobile).trim())) return res.status(400).send("Please enter valid 10 digit mobile number.");
  await pool.query(`INSERT INTO sunny_matta_contributions (name, company, city, mobile, amount, approved) VALUES ($1,$2,$3,$4,$5,FALSE)`,[name.trim(), company.trim(), city.trim(), mobile.trim(), Number(amount)]);
  res.send(`<!DOCTYPE html><html><head><title>Thank You</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:Arial;background:#f5f7f3;margin:0;padding:20px;text-align:center}.box{max-width:480px;margin:50px auto;background:white;padding:35px;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.12)}h2{color:#245b35;font-size:32px}p{font-size:17px;line-height:1.5}.contact{font-size:22px;font-weight:bold}a{display:inline-block;margin-top:18px;background:#245b35;color:white;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:bold}</style></head><body><div class="box"><h2>Thank You</h2><p>Your details submitted successfully.</p><p>Aapki payment approve hone ke baad aapka naam contributors list me show ho jayega.</p><p>Confirmation ke liye sampark kare:</p><p class="contact">+91 8851235015</p><a href="/">Back to Form</a></div></body></html>`);
});

app.get("/admin", async(req,res)=>{
  const {user, pass} = req.query;
  if(!auth(user, pass)){
    return res.send(`<!DOCTYPE html><html><head><title>Admin Login</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:Arial;background:linear-gradient(135deg,#f5f7f3,#fff);margin:0;padding:20px}.box{max-width:420px;margin:80px auto;background:white;padding:30px;border-radius:18px;box-shadow:0 12px 35px rgba(0,0,0,.12);text-align:center}h2{color:#245b35}input{width:100%;box-sizing:border-box;padding:13px;margin:9px 0;border-radius:10px;border:1px solid #ccc;font-size:16px;text-align:center}button{width:100%;padding:13px;background:#245b35;color:white;border:0;border-radius:10px;font-size:17px;font-weight:bold;cursor:pointer}</style></head><body><div class="box"><h2>Admin Login</h2><form><input name="user" placeholder="Username" required><input name="pass" type="password" placeholder="Password" required><button>Login</button></form></div></body></html>`);
  }

  const data = await pool.query(`SELECT *, created_at AT TIME ZONE 'Asia/Kolkata' AS created_at_ist FROM sunny_matta_contributions ORDER BY id DESC`);
  const stats = await pool.query(`SELECT COALESCE(SUM(CASE WHEN approved THEN amount ELSE 0 END),0) approved_total, COALESCE(SUM(amount),0) all_total, COUNT(*) FILTER (WHERE approved = TRUE) approved_count, COUNT(*) FILTER (WHERE approved = FALSE) pending_count FROM sunny_matta_contributions`);
  const rows = data.rows.map((i,n)=>`<tr><td>${n+1}</td><td><b>${safe(i.name)}</b></td><td>${safe(i.company)}</td><td>${safe(i.city)}</td><td>${safe(i.mobile)}</td><td><form method="POST" action="/edit-amount" class="inline-form"><input type="hidden" name="id" value="${i.id}"><input type="hidden" name="user" value="${safe(user)}"><input type="hidden" name="pass" value="${safe(pass)}"><input name="amount" value="${i.amount}" class="amount-input"><button class="save-btn">Save</button></form></td><td>${i.approved ? "<span class='badge approved'>Approved</span>" : "<span class='badge pending'>Pending</span>"}</td><td>${new Date(i.created_at_ist).toLocaleString("en-IN")}</td><td>${i.approved ? "<span class='muted'>Done</span>" : `<form method="POST" action="/approve" class="inline-form"><input type="hidden" name="id" value="${i.id}"><input type="hidden" name="user" value="${safe(user)}"><input type="hidden" name="pass" value="${safe(pass)}"><button class="approve-btn">Approve</button></form>`}</td><td><form method="POST" action="/delete" class="inline-form" onsubmit="return confirm('Delete this entry?')"><input type="hidden" name="id" value="${i.id}"><input type="hidden" name="user" value="${safe(user)}"><input type="hidden" name="pass" value="${safe(pass)}"><button class="delete-btn">Delete</button></form></td></tr>`).join("");
  const s = stats.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Sunny Matta Admin</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>*{box-sizing:border-box}body{font-family:Arial;background:#f4f6f2;margin:0;padding:20px;color:#222}.wrap{max-width:1250px;margin:auto}.header{background:linear-gradient(135deg,#245b35,#15351f);color:white;padding:28px;border-radius:18px;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,.16)}.header h1{margin:0;font-size:34px}.header p{margin:8px 0 0;color:#dbe7d8}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin:20px 0}.stat{background:white;padding:22px;border-radius:16px;box-shadow:0 8px 25px rgba(0,0,0,.08);text-align:center}.stat h3{margin:0;color:#666;font-size:15px;font-weight:500}.stat p{margin:10px 0 0;font-size:30px;font-weight:800;color:#245b35}.tools{text-align:center;background:white;padding:18px;border-radius:16px;box-shadow:0 8px 25px rgba(0,0,0,.08);margin-bottom:20px}.download{background:#111;color:white;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block}.card{background:white;border-radius:16px;padding:18px;box-shadow:0 8px 25px rgba(0,0,0,.08)}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:1050px}th{background:#222;color:white;padding:13px;text-align:center;font-size:14px}td{border-bottom:1px solid #e3e3e3;padding:10px;text-align:center;vertical-align:middle}tr:hover{background:#fafafa}.inline-form{display:flex;gap:6px;justify-content:center;align-items:center;margin:0}.amount-input{width:90px;padding:8px;border:1px solid #ccc;border-radius:8px;text-align:center}button{border:0;border-radius:8px;padding:8px 11px;color:white;cursor:pointer;font-weight:bold}.save-btn{background:#2563eb}.approve-btn{background:#16a34a}.delete-btn{background:#dc2626}.badge{padding:6px 10px;border-radius:20px;font-weight:bold;font-size:13px}.approved{background:#dcfce7;color:#166534}.pending{background:#fef3c7;color:#92400e}.muted{color:#777}</style></head><body><div class="wrap"><div class="header"><h1>Sunny Matta Contribution Admin</h1><p>Manage payments, approvals, contributors and Excel export</p></div><div class="stats"><div class="stat"><h3>Approved Total Amount</h3><p>${formatINR(s.approved_total)}</p></div><div class="stat"><h3>All Submitted Amount</h3><p>${formatINR(s.all_total)}</p></div><div class="stat"><h3>Approved Contributors</h3><p>${s.approved_count}</p></div><div class="stat"><h3>Pending Approvals</h3><p>${s.pending_count}</p></div></div><div class="tools"><a class="download" href="/download-excel?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}">Download Excel</a></div><div class="card"><h2 style="text-align:center;margin-top:0">All Entries</h2><div class="scroll"><table><tr><th>S.No</th><th>Name</th><th>Company</th><th>City</th><th>Mobile</th><th>Amount Edit</th><th>Status</th><th>Date & Time</th><th>Approve</th><th>Delete</th></tr>${rows || `<tr><td colspan="10">No entries yet.</td></tr>`}</table></div></div></div></body></html>`);
});

app.post("/approve", async(req,res)=>{ const {id,user,pass}=req.body; if(!auth(user,pass)) return res.status(401).send("Unauthorized"); await pool.query("UPDATE sunny_matta_contributions SET approved=TRUE WHERE id=$1",[id]); res.redirect(`/admin?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`); });
app.post("/edit-amount", async(req,res)=>{ const {id,amount,user,pass}=req.body; if(!auth(user,pass)) return res.status(401).send("Unauthorized"); await pool.query("UPDATE sunny_matta_contributions SET amount=$1 WHERE id=$2",[Number(amount),id]); res.redirect(`/admin?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`); });
app.post("/delete", async(req,res)=>{ const {id,user,pass}=req.body; if(!auth(user,pass)) return res.status(401).send("Unauthorized"); await pool.query("DELETE FROM sunny_matta_contributions WHERE id=$1",[id]); res.redirect(`/admin?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`); });

app.get("/download-excel", async(req,res)=>{
  const {user,pass}=req.query; if(!auth(user,pass)) return res.send("Unauthorized");
  const result = await pool.query(`SELECT name, company, city, mobile, amount, approved, created_at AT TIME ZONE 'Asia/Kolkata' AS created_at_ist FROM sunny_matta_contributions ORDER BY id ASC`);
  const totalResult = await pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM sunny_matta_contributions WHERE approved = TRUE`);
  const excelData = [["S.No","Name","Company","City","Mobile","Amount","Status","Date & Time"], ...result.rows.map((i,index)=>[index+1,i.name,i.company,i.city,i.mobile,Number(i.amount),i.approved?"Approved":"Pending",new Date(i.created_at_ist).toLocaleString("en-IN")]), [], ["","","","","APPROVED TOTAL",Number(totalResult.rows[0].total),"",""]];
  const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(excelData); ws["!cols"]=[{wch:8},{wch:24},{wch:28},{wch:18},{wch:16},{wch:14},{wch:14},{wch:24}]; XLSX.utils.book_append_sheet(wb,ws,"Contributions");
  const buffer = XLSX.write(wb,{type:"buffer",bookType:"xlsx"}); res.setHeader("Content-Disposition","attachment; filename=Sunny_Matta_Contribution.xlsx"); res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); res.send(buffer);
});

initDB().then(()=>{ app.listen(PORT,()=>console.log("Server running on " + PORT)); }).catch(err=>{ console.error("Database error:", err); process.exit(1); });
