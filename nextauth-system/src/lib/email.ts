import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string
) {
  await transporter.sendMail({
    from: `"Auth System" <${process.env.EMAIL_FROM}>`,
    to,
    subject: "Reset your password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9fafb;border-radius:8px;">
        <h2 style="color:#1d4ed8;margin-bottom:8px;">Reset Your Password</h2>
        <p style="color:#374151;">Hi ${name},</p>
        <p style="color:#374151;">Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">
          Reset Password
        </a>
        <p style="color:#6b7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">Or copy this link: ${resetUrl}</p>
      </div>
    `,
  });
}
