// ===================== موقع الكلية =====================
// الإعدادات تجي من متغيرات البيئة (Environment Variables) في الاستضافة:
// MONGO_URI, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SITE_URL, SESSION_SECRET, DISCORD_INVITE, TURN_URL, TURN_USER, TURN_PASS, PORT
const SETTINGS = {
    MONGO_URI: process.env.MONGO_URI || "",
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || "",
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || "",
    SITE_URL: process.env.SITE_URL || "",
    SESSION_SECRET: process.env.SESSION_SECRET || "",
    DISCORD_INVITE: process.env.DISCORD_INVITE || "https://discord.gg/XXXXXXX", // زر "دخول ديسكورد" بصفحة التدريب
    TURN_URL: process.env.TURN_URL || "", TURN_USER: process.env.TURN_USER || "", TURN_PASS: process.env.TURN_PASS || "", // اختياري
    PORT: process.env.PORT || 7700,
};
const express = require("express"), session = require("express-session"), MongoStore = require("connect-mongo");
const mongoose = require("mongoose"), crypto = require("crypto");
const CFG = {
    MONGO_URI: SETTINGS.MONGO_URI || process.env.MONGO_URI || "",
    CLIENT_ID: SETTINGS.DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || "",
    CLIENT_SECRET: SETTINGS.DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || "",
    SITE_URL: String(SETTINGS.SITE_URL || process.env.SITE_URL || "").replace(/\/$/, ""),
    SESSION_SECRET: SETTINGS.SESSION_SECRET || process.env.SESSION_SECRET || "غيّر_هذا_السر",
    DISCORD_INVITE: SETTINGS.DISCORD_INVITE,
    PORT: SETTINGS.PORT || process.env.PORT || 7700,
    SECTORS: ["الدوريات الأمنية", "أمن الطرق", "مكافحة المخدرات", "الشرطة العسكرية", "الأمن السيبراني", "الإدارة"],
    DEFAULT_RANKS: ["جندي", "جندي أول", "عريف", "وكيل رقيب", "رقيب", "رقيب أول", "رئيس رقباء"],
};
if (!CFG.MONGO_URI) { console.error("❌ حط المتغير MONGO_URI في الاستضافة"); process.exit(1); }
mongoose.connect(CFG.MONGO_URI).then(() => console.log("✅ قاعدة الكلية"));

// نفس الكولكشنات اللي يكتب فيها البوت
const Account = mongoose.model("Account", new mongoose.Schema({
    uid: { type: String, unique: true }, username: String, avatar: String,
    role: { type: String, default: "trainee" }, name: String, age: Number, sector: String,
    stage: { type: String, default: "apply" }, // apply | interview | training | approval | graduated | rejected
    trainerUid: String, interviewAt: Date, rank: String, shown: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
}, { minimize: false }), "accounts");
const Application = mongoose.model("Application", new mongoose.Schema({ uid: String, status: String }, { strict: false }), "applications");
const BotJob = mongoose.model("BotJob", new mongoose.Schema({
    type: { type: String, default: "dm" }, uid: String, title: String, description: String,
    fields: [{ name: String, value: String }], claimed: { type: Boolean, default: false }, done: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
}), "botjobs");
const LoginToken = mongoose.model("LoginToken", new mongoose.Schema({ token: { type: String, unique: true }, uid: String, expiresAt: Date, used: { type: Boolean, default: false } }), "logintokens");
const Reg = mongoose.model("Reg", new mongoose.Schema({
    uid: { type: String, unique: true }, answers: [String], status: { type: String, default: "pending" }, createdAt: { type: Date, default: Date.now },
}), "regs");
const SectorCfg = mongoose.model("SectorCfg", new mongoose.Schema({
    sector: { type: String, unique: true }, intro: { type: String, default: "" }, schedule: { type: String, default: "" },
    rules: { type: String, default: "" }, terms: { type: String, default: "" }, questions: { type: [String], default: [] },
    trainingText: { type: String, default: "" }, ranks: { type: [String], default: [] },
}), "sectorcfgs");

const Setting = mongoose.model("Setting", new mongoose.Schema({ key: { type: String, unique: true }, value: String }), "settings");
const dm = (uid, title, description, fields) => BotJob.create({ type: "dm", uid, title, description, fields: fields || [] }).catch(() => {});
const getCfg = async (s) => { const c = (await SectorCfg.findOne({ sector: s }).lean()) || { sector: s, intro: "", schedule: "", rules: "", terms: "", questions: [], trainingText: "", ranks: [] }; if (!c.ranks.length) c.ranks = CFG.DEFAULT_RANKS; return c; };

// ---------- السيرفر ----------
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.use(session({
    secret: CFG.SESSION_SECRET, resave: false, saveUninitialized: false, rolling: true,
    store: MongoStore.create({ mongoUrl: CFG.MONGO_URI, collectionName: "sessions" }),
    cookie: { maxAge: 90 * 24 * 3600 * 1000, httpOnly: true, sameSite: "lax", secure: "auto" },
}));
const deny = (res, msg) => res.status(403).send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a1628;color:#e2e8f0;font-family:Tahoma,sans-serif;text-align:center"><div style="padding:30px"><div style="font-size:60px">🚫</div><h2>${msg}</h2></div>`);

// ---------- الدخول المباشر برابط البوت (من غير ما يسجل دخول) ----------
app.get("/enter/:token", async (req, res) => {
    try {
        const t = await LoginToken.findOneAndUpdate({ token: String(req.params.token), used: false, expiresAt: { $gt: new Date() } }, { $set: { used: true } });
        if (!t) return deny(res, "الرابط منتهي أو مستخدم. اكتب /دخول-الموقع بالديسكورد وخذ رابط جديد");
        const acc = await Account.findOne({ uid: t.uid });
        if (!acc) return deny(res, "ما قدّمت عن طريق البوت، الدخول ممنوع");
        if (acc.shown) return deny(res, "تم إغلاق الموقع على حسابك");
        req.session.uid = acc.uid; // ينحفظ دخوله 90 يوم
        req.session.save(() => res.redirect("/"));
    } catch (e) { console.error(e); deny(res, "صار خطأ"); }
});
// ---------- الدخول بديسكورد (احتياطي) ----------
app.get("/auth/discord", (req, res) => {
    req.session.st = crypto.randomBytes(12).toString("hex");
    res.redirect("https://discord.com/oauth2/authorize?" + new URLSearchParams({ client_id: CFG.CLIENT_ID, redirect_uri: CFG.SITE_URL + "/auth/discord/callback", response_type: "code", scope: "identify", state: req.session.st }));
});
app.get("/auth/discord/callback", async (req, res) => {
    try {
        if (!req.query.code || req.query.state !== req.session.st) return deny(res, "طلب غير صالح");
        const tr = await (await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: CFG.CLIENT_ID, client_secret: CFG.CLIENT_SECRET, grant_type: "authorization_code", code: req.query.code, redirect_uri: CFG.SITE_URL + "/auth/discord/callback" }) })).json();
        if (!tr.access_token) return deny(res, "فشل الدخول");
        const u = await (await fetch("https://discord.com/api/users/@me", { headers: { Authorization: "Bearer " + tr.access_token } })).json();
        const acc = await Account.findOne({ uid: u.id });
        if (!acc) {
            const a = await Application.findOne({ uid: u.id }).lean();
            return deny(res, a && a.status === "pending" ? "طلبك قيد المراجعة" : "ما قدّمت عن طريق البوت، الدخول ممنوع");
        }
        if (acc.shown) return deny(res, "تم إغلاق الموقع على حسابك");
        acc.username = u.username;
        acc.avatar = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256` : "https://cdn.discordapp.com/embed/avatars/0.png";
        await acc.save();
        req.session.uid = u.id;
        res.redirect("/");
    } catch (e) { console.error(e); deny(res, "صار خطأ"); }
});
app.get("/auth/logout", (req, res) => req.session.destroy(() => res.redirect("/")));

// ---------- API ----------
const auth = (role) => async (req, res, next) => {
    const a = req.session.uid && await Account.findOne({ uid: req.session.uid });
    if (!a || a.shown) return res.status(401).json({ error: "غير مسجل" });
    if (role && a.role !== role) return res.status(403).json({ error: "ما عندك صلاحية" });
    req.acc = a; next();
};
const pub = (a) => ({ uid: a.uid, username: a.username, avatar: a.avatar, role: a.role, name: a.name, sector: a.sector, stage: a.stage, rank: a.rank, interviewAt: a.interviewAt });

app.get("/api/me", auth(), async (req, res) => {
    const a = req.acc, out = { me: pub(a), sectors: CFG.SECTORS, invite: CFG.DISCORD_INVITE };
    if (a.role === "senior") return res.json(out);
    out.cfg = await getCfg(a.sector);
    if (a.role === "trainee") {
        if (a.stage === "apply") out.reg = await Reg.findOne({ uid: a.uid }).lean();
        if (a.trainerUid) { const t = await Account.findOne({ uid: a.trainerUid }).lean(); out.trainer = t && { name: t.name, avatar: t.avatar }; }
        if (a.stage === "graduated" || a.stage === "rejected") { a.shown = true; await a.save(); req.session.destroy(() => {}); } // يظهر مرة وحدة وينقفل
    }
    res.json(out);
});
app.post("/api/register", auth("trainee"), async (req, res) => {
    if (req.acc.stage !== "apply") return res.status(400).json({ error: "غير متاح" });
    if (await Reg.findOne({ uid: req.acc.uid })) return res.status(400).json({ error: "قدمت مسبقاً" });
    const cfg = await getCfg(req.acc.sector), ans = (req.body.answers || []).map(x => String(x).slice(0, 1500));
    if (ans.length !== cfg.questions.length || ans.some(x => !x.trim())) return res.status(400).json({ error: "جاوب على كل الأسئلة" });
    await Reg.create({ uid: req.acc.uid, answers: ans }); res.json({ ok: true });
});

// المدرب
app.get("/api/trainer/mine", auth("trainer"), async (req, res) => {
    const l = await Account.find({ trainerUid: req.acc.uid, stage: { $in: ["interview", "training"] } }).lean();
    res.json(l.map(pub));
});
app.post("/api/trainer/decide/:uid", auth("trainer"), async (req, res) => {
    const t = await Account.findOne({ uid: req.params.uid, trainerUid: req.acc.uid, stage: "training" });
    if (!t) return res.status(404).json({ error: "غير موجود" });
    t.stage = req.body.accept ? "approval" : "rejected"; await t.save();
    if (!req.body.accept) await dm(t.uid, "❌ لم يتم قبولك", "المدرب ما قبلك بالتدريب.");
    res.json({ ok: true });
});

// الكبار
app.get("/api/senior/state", auth("senior"), async (req, res) => {
    const [regs, accs] = await Promise.all([Reg.find({ status: "pending" }).lean(), Account.find().lean()]);
    const by = Object.fromEntries(accs.map(a => [a.uid, a]));
    const cfgs = {}; for (const s of CFG.SECTORS) cfgs[s] = await getCfg(s);
    res.json({
        regs: await Promise.all(regs.map(async r => ({ ...r, acc: pub(by[r.uid] || {}), questions: (cfgs[(by[r.uid] || {}).sector] || {}).questions || [] }))),
        interviews: accs.filter(a => a.stage === "interview" && a.interviewAt).map(pub),
        approvals: accs.filter(a => a.stage === "approval").map(a => ({ ...pub(a), trainer: (by[a.trainerUid] || {}).name })),
        accounts: accs.map(pub), cfgs, terms: ((await Setting.findOne({ key: "terms" }).lean()) || {}).value || "",
    });
});
app.post("/api/senior/reg/:uid", auth("senior"), async (req, res) => {
    const a = await Account.findOne({ uid: req.params.uid, stage: "apply" }); if (!a) return res.status(404).json({ error: "غير موجود" });
    if (req.body.accept) {
        const t = await Account.findOne({ uid: req.body.trainerUid, role: "trainer" });
        if (!t || !req.body.interviewAt) return res.status(400).json({ error: "حدد المدرب والموعد" });
        Object.assign(a, { stage: "interview", trainerUid: t.uid, interviewAt: new Date(req.body.interviewAt) });
        await dm(a.uid, "✅ تم قبول تسجيلك", "حان وقت المقابلة.", [{ name: "المدرب", value: t.name || t.username }, { name: "الموعد", value: a.interviewAt.toLocaleString("ar-SA") }]);
    } else { a.stage = "rejected"; await dm(a.uid, "❌ تم رفض تسجيلك", "للأسف ما تم قبول تسجيلك."); }
    await a.save(); await Reg.updateOne({ uid: a.uid }, { $set: { status: req.body.accept ? "accepted" : "rejected" } }); res.json({ ok: true });
});
app.post("/api/senior/interview/:uid", auth("senior"), async (req, res) => {
    const a = await Account.findOne({ uid: req.params.uid, stage: "interview" }); if (!a) return res.status(404).json({ error: "غير موجود" });
    a.stage = req.body.pass ? "training" : "rejected"; await a.save();
    await dm(a.uid, req.body.pass ? "✅ نجحت بالمقابلة" : "❌ لم تنجح بالمقابلة", req.body.pass ? "انتقلت لمرحلة التدريب." : "للأسف ما تم قبولك."); res.json({ ok: true });
});
app.post("/api/senior/approve/:uid", auth("senior"), async (req, res) => {
    const a = await Account.findOne({ uid: req.params.uid, stage: "approval" }); if (!a) return res.status(404).json({ error: "غير موجود" });
    if (req.body.approve) {
        const cfg = await getCfg(a.sector); if (!cfg.ranks.includes(req.body.rank)) return res.status(400).json({ error: "حدد الرتبة" });
        a.stage = "graduated"; a.rank = req.body.rank;
        await dm(a.uid, "🎓 تم قبولك", "تم قبولك بالكلية.", [{ name: "الرتبة", value: a.rank }, { name: "القطاع", value: a.sector }]);
    } else { a.stage = "rejected"; await dm(a.uid, "❌ لم يتم اعتمادك", "للأسف ما تم اعتماد قبولك."); }
    await a.save(); res.json({ ok: true });
});
app.post("/api/senior/account", auth("senior"), async (req, res) => { // فتح حساب (مدرب/متدرب/كبير)
    const { uid, role, sector, name } = req.body || {};
    if (!/^\d{15,22}$/.test(String(uid)) || !["trainer", "trainee", "senior"].includes(role)) return res.status(400).json({ error: "بيانات غير صحيحة" });
    if (role !== "senior" && !CFG.SECTORS.includes(sector)) return res.status(400).json({ error: "حدد القطاع" });
    if (await Account.findOne({ uid })) return res.status(400).json({ error: "عنده حساب (حساب واحد لكل عضو)" });
    await Account.create({ uid, role, sector: role === "senior" ? null : sector, name: String(name || "").slice(0, 40), username: "-", stage: role === "trainee" ? "apply" : "graduated" });
    res.json({ ok: true });
});
app.post("/api/senior/account/:uid/delete", auth("senior"), async (req, res) => {
    if (req.params.uid === req.acc.uid) return res.status(400).json({ error: "ما تحذف نفسك" });
    await Account.deleteOne({ uid: req.params.uid }); await Reg.deleteOne({ uid: req.params.uid }); res.json({ ok: true });
});
app.post("/api/senior/terms", auth("senior"), async (req, res) => { // شروط التقديم (تظهر بإيمبد /تسجيل)
    await Setting.findOneAndUpdate({ key: "terms" }, { $set: { value: String((req.body || {}).text || "").slice(0, 3800) } }, { upsert: true }); res.json({ ok: true });
});
app.post("/api/senior/sector/:s", auth("senior"), async (req, res) => {
    if (!CFG.SECTORS.includes(req.params.s)) return res.status(400).json({ error: "قطاع غلط" });
    const b = req.body || {}, lines = (x) => String(x || "").split("\n").map(s => s.trim()).filter(Boolean).slice(0, 40);
    await SectorCfg.findOneAndUpdate({ sector: req.params.s }, { $set: { intro: String(b.intro || ""), schedule: String(b.schedule || ""), rules: String(b.rules || ""), terms: String(b.terms || "").slice(0, 1800),
        trainingText: String(b.trainingText || ""), questions: lines(b.questions), ranks: lines(b.ranks) } }, { upsert: true });
    res.json({ ok: true });
});

// ---------- الروم الصوتي للمقابلة (WebRTC + SSE) ----------
const sse = new Map(), rooms = new Map(), roomMode = new Map(); // room = uid المتدرب
const sendTo = (uid, p) => { const st = sse.get(uid); if (st) for (const r of st) { try { r.write("data: " + JSON.stringify(p) + "\n\n"); } catch (e) {} } };
const vState = (room) => ({ room, mode: roomMode.get(room) || "open", participants: Array.from((rooms.get(room) || new Map()).values()) });
const vPush = (room) => { const m = rooms.get(room); if (m) for (const u of m.keys()) sendTo(u, { t: "state", state: vState(room) }); };
function vRemove(uid, room) { const m = rooms.get(room); if (!m || !m.has(uid)) return; m.delete(uid); if (!m.size) { rooms.delete(room); roomMode.delete(room); } else vPush(room); }
const vIce = () => { const a = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
    if (SETTINGS.TURN_URL) a.push({ urls: SETTINGS.TURN_URL.split(",").map(x => x.trim()).filter(Boolean), username: SETTINGS.TURN_USER, credential: SETTINGS.TURN_PASS }); return a; };
async function vCan(acc, room) { // فقط: المتدرب نفسه + مدربه + الكبار
    const t = await Account.findOne({ uid: String(room), role: "trainee", stage: "interview" });
    if (!t) return "المقابلة غير متاحة";
    if (acc.role === "senior") return null;
    if (acc.role === "trainer") return t.trainerUid === acc.uid ? null : "هذا مو متدربك";
    if (acc.uid === t.uid) return !t.interviewAt ? "ما تحدد موعدك" : (Date.now() >= t.interviewAt.getTime() - 5 * 60000 ? null : "الروم يفتح قبل الموعد بـ 5 دقايق");
    return "ما عندك صلاحية";
}
app.get("/api/v/events", auth(), (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders(); res.write(": ok\n\n");
    const uid = req.acc.uid; if (!sse.has(uid)) sse.set(uid, new Set()); sse.get(uid).add(res);
    const hb = setInterval(() => { try { res.write(": hb\n\n"); } catch (e) {} }, 20000);
    req.on("close", () => { clearInterval(hb); const st = sse.get(uid); if (!st) return; st.delete(res);
        if (!st.size) { sse.delete(uid); setTimeout(() => { if (!sse.has(uid)) for (const r of Array.from(rooms.keys())) vRemove(uid, r); }, 15000); } });
});
app.post("/api/v/join", auth(), async (req, res) => {
    const room = String(req.body.room || ""), err = await vCan(req.acc, room);
    if (err) return res.status(403).json({ error: err });
    for (const r of Array.from(rooms.keys())) if (r !== room) vRemove(req.acc.uid, r);
    if (!rooms.has(room)) rooms.set(room, new Map());
    rooms.get(room).set(req.acc.uid, { uid: req.acc.uid, name: req.acc.name || req.acc.username, role: req.acc.role, micOn: true, joinedAt: Date.now() });
    vPush(room); res.json({ ok: true, ice: vIce(), state: vState(room) });
});
app.post("/api/v/leave", auth(), (req, res) => { vRemove(req.acc.uid, String(req.body.room || "")); res.json({ ok: true }); });
app.post("/api/v/signal", auth(), (req, res) => {
    const m = rooms.get(String(req.body.room || "")), to = String(req.body.to || "");
    if (!m || !m.has(req.acc.uid) || !m.has(to)) return res.status(400).json({ error: "غير موجود" });
    sendTo(to, { t: "sig", from: req.acc.uid, data: req.body.data }); res.json({ ok: true });
});
app.post("/api/v/mic", auth(), (req, res) => { const m = rooms.get(String(req.body.room || "")), p = m && m.get(req.acc.uid); if (p) { p.micOn = !!req.body.micOn; vPush(req.body.room); } res.json({ ok: true }); });
app.post("/api/v/mode", auth(), (req, res) => { // المدرب/الكبار: فتح أو إسكات المتدرب
    const room = String(req.body.room || ""), m = rooms.get(room);
    if (req.acc.role === "trainee" || !m || !m.has(req.acc.uid)) return res.status(403).json({ error: "ما عندك صلاحية" });
    roomMode.set(room, req.body.mode === "listen" ? "listen" : "open"); vPush(room); res.json({ ok: true });
});

// ---------- الواجهة ----------
app.get("/", (_, res) => res.send(PAGE));
const PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الكلية</title>
<style>
:root{--bg1:#0a1628;--bg2:#0d1f3c;--panel:rgba(255,255,255,.04);--border:rgba(59,130,246,.25);--blue:#3b82f6;--soft:#60a5fa;--red:#ef4444;--green:#22c55e;--text:#e2e8f0;--muted:#64748b}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(160deg,var(--bg1),var(--bg2));color:var(--text);font-family:Tahoma,Arial,sans-serif}
.wrap{max-width:900px;margin:auto;padding:16px}.panel{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;margin:12px 0}
h2,h3{margin:.2em 0;color:var(--soft)}.muted{color:var(--muted);font-size:13px}.pre{white-space:pre-wrap;line-height:1.9}
button,.btn{background:linear-gradient(135deg,#1d4ed8,var(--blue));color:#fff;border:0;border-radius:10px;padding:10px 16px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.red{background:linear-gradient(135deg,#b91c1c,var(--red))}button.gray{background:#1e293b;border:1px solid var(--border)}button.green{background:linear-gradient(135deg,#15803d,var(--green))}
input,textarea,select{width:100%;background:#0b1730;color:var(--text);border:1px solid var(--border);border-radius:10px;padding:10px;font:inherit;margin:6px 0}textarea{min-height:90px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tabs button{background:#1e293b;border:1px solid var(--border)}.tabs button.on{background:linear-gradient(135deg,#1d4ed8,var(--blue))}
.top{display:flex;align-items:center;gap:10px}.top img{width:42px;height:42px;border-radius:50%}.sp{flex:1}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.center{text-align:center;padding:60px 10px}
</style></head><body><div class="wrap" id="app"></div>
<script>
const $=s=>document.querySelector(s),app=$("#app");let S=null,tab=null;
const h=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const api=async(p,b)=>{const r=await fetch(p,b?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}:{});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"خطأ");return j};
const act=async(p,b)=>{try{await api(p,b);await load(true)}catch(e){alert(e.message)}};
async function load(keep){try{S=await api("/api/me")}catch(e){return login()}if(!keep)tab=null;render()}
function login(){app.innerHTML='<div class="center"><h1>🎓 الكلية</h1><p class="muted">ادخل من زر "دخول الموقع" اللي وصلك خاص من البوت، أو اكتب /دخول-الموقع بالديسكورد.</p><a class="btn gray" href="/auth/discord">أو سجّل بحساب ديسكورد</a></div>'}
function head(){const m=S.me;return '<div class="panel top"><img src="'+h(m.avatar)+'"><div><b>'+h(m.name||m.username)+'</b><div class="muted">'+({senior:"كبار المسؤولين",trainer:"مدرب",trainee:"متدرب"}[m.role])+(m.sector?" — "+h(m.sector):"")+'</div></div><div class="sp"></div><a class="btn gray" href="/auth/logout">خروج</a></div>'}
function render(){const m=S.me;let x=head();
 if(m.role==="senior")x+=seniorView();else if(m.role==="trainer")x+=trainerView();else x+=traineeView();
 app.innerHTML=x;if(m.role==="senior"&&!tab)loadSenior();}
// ===== المتدرب =====
function traineeView(){const m=S.me,c=S.cfg;
 if(m.stage==="graduated")return '<div class="panel center"><h2>🎓 تم قبولك</h2><p style="font-size:20px">تم قبولك برتبة <b>'+h(m.rank)+'</b> وقطاعك <b>'+h(m.sector)+'</b></p><p class="muted">صوّر الشاشة، ما تقدر تدخل الموقع مرة ثانية.</p></div>';
 if(m.stage==="rejected")return '<div class="panel center"><h2>❌ لم يتم قبولك</h2><p class="muted">ما تقدر تدخل الموقع مرة ثانية.</p></div>';
 const mid={apply:"تسجيل",interview:"المقابلة",training:"التدريب",approval:"التدريب"}[m.stage];
 const t=tab||"home";let b="";
 if(t==="home")b='<h3>عن الدورة</h3><div class="pre">'+h(c.intro)+'</div><h3>التنظيم والأيام</h3><div class="pre">'+h(c.schedule)+'</div>';
 else if(t==="rules")b='<h3>القوانين</h3><div class="pre">'+h(c.rules)+'</div>';
 else b=midView(m,c);
 return '<div class="tabs"><button class="'+(t==="home"?"on":"")+'" onclick="tab=\\'home\\';render()">الرئيسية</button><button class="'+(t==="rules"?"on":"")+'" onclick="tab=\\'rules\\';render()">القوانين</button><button class="'+(t==="mid"?"on":"")+'" onclick="tab=\\'mid\\';render()">'+mid+'</button></div><div class="panel">'+b+'</div>'}
function midView(m,c){
 if(m.stage==="apply"){if(S.reg)return '<h3>⏳ تسجيلك قيد المراجعة</h3><p class="muted">بيتواصل معك الكبار.</p>';
  if(!c.questions.length)return '<p class="muted">باب التسجيل لسه ما انفتح.</p>';
  return '<h3>أسئلة التسجيل</h3>'+c.questions.map((q,i)=>'<div>'+h(q)+'<textarea id="q'+i+'"></textarea></div>').join("")+'<button onclick="sendReg()">إرسال</button>'}
 if(m.stage==="interview")return '<h3>🎙️ المقابلة</h3><p>المدرب: <b>'+h(S.trainer&&S.trainer.name)+'</b></p><p>الموعد: <b>'+new Date(m.interviewAt).toLocaleString("ar-SA")+'</b></p><p class="muted">الروم يفتح قبل الموعد بـ 5 دقايق.</p><button onclick="vJoin(\\''+m.uid+'\\')">🎙️ دخول الروم الصوتي</button>';
 if(m.stage==="training")return '<h3>التدريب</h3><a class="btn" target="_blank" href="'+h(S.invite)+'">دخول ديسكورد</a><div class="pre" style="margin-top:14px">'+h(c.trainingText)+'</div>';
 return '<h3>⏳ بانتظار اعتماد الكبار</h3><p class="muted">المدرب قبلك، وينتظر قرار الكبار.</p>'}
async function sendReg(){const a=S.cfg.questions.map((_,i)=>$("#q"+i).value);try{await api("/api/register",{answers:a});load(true)}catch(e){alert(e.message)}}
// ===== المدرب =====
function trainerView(){setTimeout(async()=>{const l=await api("/api/trainer/mine");$("#tl").innerHTML=l.length?l.map(a=>'<div class="panel row"><img src="'+h(a.avatar)+'" width=36 style="border-radius:50%"><b>'+h(a.name||a.username)+'</b><span class="muted">'+(a.stage==="interview"?"مقابلة":"تدريب")+'</span><div class="sp"></div>'+(a.stage==="interview"?'<button onclick="vJoin(\\''+a.uid+'\\')">🎙️ دخول الروم</button>':'')+(a.stage==="training"?'<button class="green" onclick="act(\\'/api/trainer/decide/'+a.uid+'\\',{accept:true})">قبول</button><button class="red" onclick="act(\\'/api/trainer/decide/'+a.uid+'\\',{accept:false})">رفض</button>':'')+'</div>').join(""):'<p class="muted">ما عندك متدربين.</p>'},0);return '<h3>متدربينك</h3><div id="tl"></div>'}
// ===== الكبار =====
let SS=null;async function loadSenior(){SS=await api("/api/senior/state");tab=tab||"regs";senior2()}
function seniorView(){return '<div id="sv"><p class="muted">جاري التحميل...</p></div>'}
function senior2(){const T={regs:"التسجيلات",iv:"المقابلات",ap:"الاعتماد",ac:"الحسابات",sc:"إعدادات القطاعات",tm:"شروط التقديم"};
 let x='<div class="tabs">'+Object.keys(T).map(k=>'<button class="'+(tab===k?"on":"")+'" onclick="tab=\\''+k+'\\';senior2()">'+T[k]+'</button>').join("")+'</div>';
 const tr=SS.accounts.filter(a=>a.role==="trainer");
 if(tab==="regs")x+=SS.regs.length?SS.regs.map(r=>'<div class="panel"><b>'+h(r.acc.name)+'</b> <span class="muted">'+h(r.acc.sector)+'</span>'+r.answers.map((a,i)=>'<p><span class="muted">'+h(r.questions[i])+'</span><br>'+h(a)+'</p>').join("")+'<select id="t'+r.uid+'"><option value="">اختر المدرب</option>'+tr.filter(t=>t.sector===r.acc.sector).map(t=>'<option value="'+t.uid+'">'+h(t.name||t.username)+'</option>').join("")+'</select><input type="datetime-local" id="d'+r.uid+'"><button class="green" onclick="regAct(\\''+r.uid+'\\',true)">قبول</button> <button class="red" onclick="regAct(\\''+r.uid+'\\',false)">رفض</button></div>').join(""):'<p class="muted">ما فيه تسجيلات.</p>';
 if(tab==="iv")x+=SS.interviews.length?SS.interviews.map(a=>'<div class="panel row"><b>'+h(a.name)+'</b><span class="muted">'+h(a.sector)+' — '+new Date(a.interviewAt).toLocaleString("ar-SA")+'</span><div class="sp"></div><button onclick="vJoin(\\''+a.uid+'\\')">🎙️ الروم</button><button class="green" onclick="sact(\\'interview\\',\\''+a.uid+'\\',{pass:true})">نجح</button><button class="red" onclick="sact(\\'interview\\',\\''+a.uid+'\\',{pass:false})">رسب</button></div>').join(""):'<p class="muted">ما فيه مقابلات.</p>';
 if(tab==="ap")x+=SS.approvals.length?SS.approvals.map(a=>'<div class="panel"><b>'+h(a.name)+'</b> — مدرب '+h(a.sector)+' ('+h(a.trainer)+') قبل هذا، نعتمد قبوله أو نرفض؟<div class="row"><select id="r'+a.uid+'">'+SS.cfgs[a.sector].ranks.map(r=>'<option>'+h(r)+'</option>').join("")+'</select><button class="green" onclick="apAct(\\''+a.uid+'\\',true)">اعتماد</button><button class="red" onclick="apAct(\\''+a.uid+'\\',false)">رفض</button></div></div>').join(""):'<p class="muted">ما فيه شي للاعتماد.</p>';
 if(tab==="ac")x+='<div class="panel"><h3>فتح حساب</h3><input id="nu" placeholder="ايدي ديسكورد"><input id="nn" placeholder="الاسم"><select id="nr"><option value="trainee">متدرب</option><option value="trainer">مدرب</option><option value="senior">كبير</option></select><select id="ns">'+S.sectors.map(s=>'<option>'+h(s)+'</option>').join("")+'</select><button onclick="newAcc()">فتح</button></div>'+SS.accounts.map(a=>'<div class="panel row"><img src="'+h(a.avatar||"")+'" width=32 style="border-radius:50%"><b>'+h(a.name||a.username)+'</b><span class="muted">'+a.role+' '+h(a.sector||"")+' '+a.stage+'</span><div class="sp"></div><button class="red" onclick="if(confirm(\\'حذف؟\\'))sact(\\'account\\',\\''+a.uid+'/delete\\',{})">حذف</button></div>').join("");
 if(tab==="sc"){const s=window.cs||S.sectors[0],c=SS.cfgs[s];x+='<div class="panel"><select onchange="window.cs=this.value;senior2()">'+S.sectors.map(z=>'<option '+(z===s?"selected":"")+'>'+h(z)+'</option>').join("")+'</select>'+[["intro","تعريف الدورة"],["schedule","التنظيم والأيام"],["rules","القوانين"],["terms","شروط التقديم (تظهر بالديسكورد قبل ما يعبي الاسم والعمر)"],["trainingText","تعليمات التدريب"]].map(f=>'<label>'+f[1]+'</label><textarea id="c_'+f[0]+'">'+h(c[f[0]])+'</textarea>').join("")+'<label>أسئلة التسجيل (سؤال بكل سطر)</label><textarea id="c_questions">'+h(c.questions.join("\\n"))+'</textarea><label>الرتب (رتبة بكل سطر)</label><textarea id="c_ranks">'+h(c.ranks.join("\\n"))+'</textarea><button onclick="saveCfg(\\''+h(s)+'\\')">حفظ</button></div>'}
 if(tab==="tm")x+='<div class="panel"><h3>شروط وقوانين التقديم</h3><p class="muted">تظهر في رسالة /تسجيل بالديسكورد. الأمر ياخذ آخر نسخة محفوظة وقت ما ينفذ.</p><textarea id="tmx" style="min-height:240px">'+h(SS.terms)+'</textarea><button onclick="saveTerms()">حفظ</button></div>';
 $("#sv").innerHTML=x}
async function sact(k,u,b){try{await api("/api/senior/"+k+"/"+u,b);await loadSenior()}catch(e){alert(e.message)}}
const regAct=(u,ok)=>sact("reg",u,{accept:ok,trainerUid:$("#t"+u)&&$("#t"+u).value,interviewAt:$("#d"+u)&&$("#d"+u).value});
const apAct=(u,ok)=>sact("approve",u,{approve:ok,rank:$("#r"+u)&&$("#r"+u).value});
const newAcc=()=>sact("account","",{uid:$("#nu").value.trim(),name:$("#nn").value,role:$("#nr").value,sector:$("#ns").value});
const saveTerms=async()=>{try{await api("/api/senior/terms",{text:$("#tmx").value});await loadSenior();alert("تم الحفظ")}catch(e){alert(e.message)}};
const saveCfg=async s=>{try{await api("/api/senior/sector/"+encodeURIComponent(s),Object.fromEntries(["intro","schedule","rules","terms","trainingText","questions","ranks"].map(k=>[k,$("#c_"+k).value])));await loadSenior();alert("تم الحفظ")}catch(e){alert(e.message)}};
// ===== الروم الصوتي =====
let V=null;
function vBox(){let b=$("#vpanel");if(!b){b=document.createElement("div");b.id="vpanel";b.style.cssText="position:fixed;bottom:10px;left:10px;right:10px;max-width:520px;margin:auto;z-index:50";document.body.appendChild(b)}return b}
function vAllowed(){return S.me.role!=="trainee"||V.state.mode==="open"}
function vRender(){const b=vBox();if(!V){b.innerHTML="";return}
 V.stream.getAudioTracks().forEach(t=>t.enabled=V.micOn&&vAllowed());
 b.innerHTML='<div class="panel" style="background:#0b1730;box-shadow:0 0 24px #000"><div class="row"><b>🎙️ روم المقابلة</b><span class="muted">'+(V.state.mode==="open"?"مفتوح":"المتدرب يستمع فقط")+'</span><div class="sp"></div>'
 +'<button class="'+(V.micOn?"":"red")+'" onclick="vMic()">'+(V.micOn?"🎤 كتم":"🔇 فتح")+'</button>'
 +(S.me.role!=="trainee"?'<button class="gray" onclick="vMode()">'+(V.state.mode==="open"?"إسكات المتدرب":"فتح المايك")+'</button>':"")
 +'<button class="red" onclick="vLeave()">خروج</button></div>'
 +V.state.participants.map(p=>'<div class="muted">'+h(p.name)+' — '+({trainee:"متدرب",trainer:"مدرب",senior:"كبير"}[p.role])+(p.micOn?"":" 🔇")+(p.uid===S.me.uid?" (أنت)":"")+'</div>').join("")
 +(S.me.role==="trainee"&&!vAllowed()?'<div class="muted">المايك مقفل لين يفتحه المدرب.</div>':"")+'</div>'}
function vSend(to,data){api("/api/v/signal",{room:V.room,to:to,data:data}).catch(function(){})}
function vPeer(uid,init){let pc=V.pcs[uid];if(pc)return pc;
 pc=new RTCPeerConnection({iceServers:V.ice,bundlePolicy:"max-bundle"});V.pcs[uid]=pc;V.q[uid]=[];
 V.stream.getTracks().forEach(t=>pc.addTrack(t,V.stream));
 pc.onicecandidate=e=>{if(e.candidate)vSend(uid,{c:e.candidate})};
 pc.ontrack=e=>{let a=document.getElementById("au"+uid);if(!a){a=document.createElement("audio");a.id="au"+uid;a.autoplay=true;a.setAttribute("playsinline","");document.body.appendChild(a)}a.srcObject=e.streams[0];a.play().catch(function(){})};
 if(init)pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>vSend(uid,{d:pc.localDescription}));
 return pc}
function vDrop(uid){const pc=V.pcs[uid];if(pc){try{pc.close()}catch(e){}}delete V.pcs[uid];delete V.q[uid];const a=document.getElementById("au"+uid);if(a)a.remove()}
async function vSig(from,d){if(!V)return;const pc=vPeer(from,false);
 if(d.d){await pc.setRemoteDescription(d.d);for(const c of V.q[from]||[])await pc.addIceCandidate(c).catch(function(){});V.q[from]=[];
  if(d.d.type==="offer"){const a=await pc.createAnswer();await pc.setLocalDescription(a);vSend(from,{d:pc.localDescription})}}
 else if(d.c){if(pc.remoteDescription)await pc.addIceCandidate(d.c).catch(function(){});else V.q[from].push(d.c)}}
function vOnMsg(m){if(!V)return;
 if(m.t==="state"){V.state=m.state;const ids=m.state.participants.map(p=>p.uid);Object.keys(V.pcs).forEach(u=>{if(ids.indexOf(u)<0)vDrop(u)});vRender()}
 else if(m.t==="sig")vSig(m.from,m.data)}
async function vJoin(room){
 if(V)return alert("أنت داخل روم");
 if(!window.RTCPeerConnection||!navigator.mediaDevices)return alert("المتصفح ما يدعم الصوت");
 let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})}catch(e){return alert("لازم تسمح للمايك")}
 const es=new EventSource("/api/v/events");
 await new Promise(r=>{es.onopen=r;setTimeout(r,4000)});
 let r;try{r=await api("/api/v/join",{room:room})}catch(e){es.close();stream.getTracks().forEach(t=>t.stop());return alert(e.message)}
 V={room:room,stream:stream,es:es,pcs:{},q:{},ice:r.ice,state:r.state,micOn:true};
 es.onmessage=ev=>vOnMsg(JSON.parse(ev.data));
 r.state.participants.forEach(p=>{if(p.uid!==S.me.uid)vPeer(p.uid,true)});
 vRender()}
function vLeave(){if(!V)return;const v=V;api("/api/v/leave",{room:v.room}).catch(function(){});Object.keys(v.pcs).forEach(vDrop);v.stream.getTracks().forEach(t=>t.stop());v.es.close();V=null;vRender()}
function vMic(){V.micOn=!V.micOn;api("/api/v/mic",{room:V.room,micOn:V.micOn}).catch(function(){});vRender()}
function vMode(){api("/api/v/mode",{room:V.room,mode:V.state.mode==="open"?"listen":"open"}).catch(function(e){alert(e.message)})}
window.addEventListener("beforeunload",()=>{if(V)navigator.sendBeacon("/api/v/leave",new Blob([JSON.stringify({room:V.room})],{type:"application/json"}))});
load();
</script></body></html>`;
app.listen(CFG.PORT, () => console.log("🚀 الكلية على المنفذ " + CFG.PORT));
