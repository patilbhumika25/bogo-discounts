import nodemailer from "nodemailer";

export async function sendOwnerEmail({ shop, title, userEmail, notes }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"BOGO App" <${process.env.SMTP_USER}>`,
    to: "bogobundlesfreegifts@gmail.com",
    subject: "New Custom Offer Request",
    html: `
      <h2>New Custom Offer Submitted</h2>
      <p><strong>Shop:</strong> ${shop}</p>
      <p><strong>Offer Title:</strong> ${title}</p>
      <p><strong>User Email:</strong> ${userEmail}</p>
      <p><strong>Message:</strong></p>
      <p>${notes || "No additional notes"}</p>
    `,
  });
}
