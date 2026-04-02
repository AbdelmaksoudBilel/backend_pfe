// =============================================================================
// services/emailService.js
// Envoi emails — toujours avec try/catch interne pour ne jamais crasher le serveur
// Si SMTP non configuré → log console uniquement (mode dev)
// =============================================================================

const nodemailer = require("nodemailer");

// ── Transporter ──────────────────────────────────────────────────
// Si les variables SMTP ne sont pas définies, nodemailer échoue silencieusement
const transporter = nodemailer.createTransport({
  host  : process.env.SMTP_HOST  || "smtp.gmail.com",
  port  : parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth  : {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
});

// ── Helper : envoi sécurisé (ne throw jamais) ─────────────────────
async function safeSend(mailOptions) {
  // En mode dev (SMTP non configuré) → log seulement
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("\n📧 [EMAIL - MODE DEV] Pas d'envoi réel :");
    console.log("  À      :", mailOptions.to);
    console.log("  Sujet  :", mailOptions.subject);
    console.log("  Lien   :", mailOptions._devLink || "(pas de lien)");
    return; // Ne pas throw
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    // Ne jamais crasher le serveur à cause d'un email
    console.error("⚠️  Erreur envoi email (non-fatal):", err.message);
  }
}

// ── Email confirmation compte ─────────────────────────────────────
exports.sendVerificationEmail = async (userEmail, name, token) => {
  const url = `${process.env.FRONTEND_URL || "http://localhost:3000"}/verify-email?token=${token}`;
  await safeSend({
    from   : process.env.EMAIL_FROM || "noreply@machance.tn",
    to     : userEmail,
    subject: "Confirmez votre compte — Ma Chance",
    _devLink: url,
    html   : `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px">
        <h2 style="color:#3BBDE8">Bonjour ${name} 👋</h2>
        <p>Merci de vous être inscrit sur <strong>Ma Chance</strong>.</p>
        <p>Cliquez sur le bouton ci-dessous pour confirmer votre email :</p>
        <a href="${url}"
           style="display:inline-block;background:#3BBDE8;color:#fff;padding:13px 28px;
                  border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          Confirmer mon email
        </a>
        <p style="color:#888;font-size:13px">Ce lien est valable 24 heures.</p>
        <hr style="border-color:#eee"/>
        <p style="color:#aaa;font-size:12px">Centre Ma Chance — Assistant Intelligent TSA & DI</p>
      </div>
    `,
  });
};

// ── Email notification admin ──────────────────────────────────────
exports.sendAdminNotification = async (adminEmail, parentName, parentEmail) => {
  await safeSend({
    from   : process.env.EMAIL_FROM || "noreply@machance.tn",
    to     : adminEmail,
    subject: "Nouvelle inscription en attente — Ma Chance",
    html   : `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px">
        <h2 style="color:#F5A623">Nouvelle inscription 🔔</h2>
        <p><strong>Nom :</strong> ${parentName}</p>
        <p><strong>Email :</strong> ${parentEmail}</p>
        <p>Connectez-vous au panneau admin pour valider ce compte.</p>
      </div>
    `,
  });
};

// ── Email approbation ─────────────────────────────────────────────
exports.sendApprovalEmail = async (userEmail, name) => {
  const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;
  await safeSend({
    from   : process.env.EMAIL_FROM || "noreply@machance.tn",
    to     : userEmail,
    subject: "Votre compte est approuvé ✅ — Ma Chance",
    html   : `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px">
        <h2 style="color:#48BB78">Bonne nouvelle, ${name} ! 🎉</h2>
        <p>Votre compte a été validé par notre équipe.</p>
        <p>Vous pouvez maintenant vous connecter et accéder à l'assistant.</p>
        <a href="${loginUrl}"
           style="display:inline-block;background:#3BBDE8;color:#fff;padding:13px 28px;
                  border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          Se connecter
        </a>
      </div>
    `,
  });
};

// ── Email refus ───────────────────────────────────────────────────
exports.sendRejectionEmail = async (userEmail, name) => {
  await safeSend({
    from   : process.env.EMAIL_FROM || "noreply@machance.tn",
    to     : userEmail,
    subject: "Votre demande d'inscription — Ma Chance",
    html   : `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px">
        <h2>Bonjour ${name},</h2>
        <p>Votre demande d'accès n'a pas pu être approuvée pour le moment.</p>
        <p>Contactez-nous à <a href="mailto:contact@machance.tn">contact@machance.tn</a>
           pour plus d'informations.</p>
      </div>
    `,
  });
};

// ── Email réinitialisation mot de passe ───────────────────────────
exports.sendPasswordResetEmail = async (userEmail, name, token) => {
  const url = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${token}`;
  await safeSend({
    from   : process.env.EMAIL_FROM || "noreply@machance.tn",
    to     : userEmail,
    subject: "Réinitialisation de votre mot de passe — Ma Chance",
    _devLink: url,
    html   : `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px">
        <h2 style="color:#3BBDE8">Réinitialisation du mot de passe</h2>
        <p>Bonjour ${name},</p>
        <p>Vous avez demandé la réinitialisation de votre mot de passe.
           Cliquez sur le lien ci-dessous (valable <strong>30 minutes</strong>) :</p>
        <a href="${url}"
           style="display:inline-block;background:#F5A623;color:#fff;padding:13px 28px;
                  border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          Réinitialiser mon mot de passe
        </a>
        <p style="color:#888;font-size:13px">
          Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
        </p>
      </div>
    `,
  });
};