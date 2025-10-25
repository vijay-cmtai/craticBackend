const nodemailer = require("nodemailer");

const sendEmail = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: process.env.MAIL_PORT == 465,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"Naraaglobal Enterprises" <${process.env.MAIL_USER}>`,
      to: to,
      subject: subject,
      html: html,
    });

    console.log(`✅ Email sent successfully to ${to}.`);
  } catch (error) {
    console.error("❌ Error sending email via Nodemailer:", error);
    console.error("Nodemailer Configuration Used:", {
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      user: process.env.MAIL_USER,
    });
    throw new Error(
      "Failed to send email. Please check server logs for details."
    );
  }
};

module.exports = { sendEmail };
