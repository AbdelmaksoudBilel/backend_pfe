require("dotenv").config();
const express   = require("express");
const mongoose  = require("mongoose");
const cors      = require("cors");
const path      = require("path");

const app = express();

// ── Middlewares globaux ───────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",                    require("./route/auth.route"));
app.use("/api/users",                   require("./route/users.route"));
app.use("/api/children",                require("./route/children.route"));
app.use("/api/conversations",           require("./route/conversations.route"));
app.use("/api/messages",                require("./route/messages.route"));
app.use("/api/responses",               require("./route/responses.route"));
app.use("/api/evaluation-templates",    require("./route/evaluation_templates.route"));
app.use("/api/evaluation-sessions",     require("./route/evaluation_sessions.route"));
app.use("/api/evaluation-responses",    require("./route/evaluation_responses.route"));
app.use("/api/dashboard",               require("./route/dashboard_admin.route"));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", ts: new Date() }));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ message: "Route introuvable" }));

// ── Connexion MongoDB + démarrage ─────────────────────────────────────────────
mongoose.connect(process.env.DATABASE)
  .then(() => {
    console.log("✔ MongoDB connecté");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`✔ Serveur démarré sur http://localhost:${PORT}`));
  })
  .catch(err => { console.error("MongoDB erreur :", err); process.exit(1); });
