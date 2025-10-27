const nodemailer = require("nodemailer");
const path = require("path");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendEmails(recipients) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "jaylimbasiya93@gmail.com",
      pass: "mjsg ikgq yokl bmew",
    },
  });

  const resumePath = path.join(__dirname, "Jay-Limbasiya-Node.js.pdf"); // file in same directory

  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: "jaylimbasiya93@gmail.com",
        to: recipient,
        subject: "Application for Software Engineer  (React & Node)  Position",
        html: `
        <p>Hello,</p>
        <p>I am Jay Limbasiya, a Software Engineer with over 3 years of experience in developing scalable and user-friendly applications.</p>
        <p>I am writing to express my interest in suitable Software Engineer opportunities at your organization. Please find my resume attached for your review. I would be glad to discuss how my skills and experience align with your requirements.</p>
        <p>JOB LINK : https://www.linkedin.com/jobs/view/4313091306/ </p>
        <p>Thank you for your time and consideration. I look forward to hearing from you.</p>
        <p>Best regards,<br>Jay Limbasiya<br></p>
        `,
        attachments: [
          {
            filename: "Jay-Limbasiya-Node.js.pdf", // change filename as per your file name
            path: resumePath,
            contentType: "application/pdf",
          },
        ],
      });

      console.log("Email sent to:", recipient);
      await delay(3000); // delay to avoid spam filters
    } catch (error) {
      console.error("Error sending email to", recipient, ":", error.message);
    }
  }
}

// List of recipients
const recipients = [
  "himanshu.malviya@netapp.com",
  "kumarh@netapp.com",
  "ishap@netapp.com",
  "sgokul@netapp.com",
  "netapp@netapp.com",
  "jayeshb@netapp.com",
  "ayusht@netapp.com",
  "anupam.agrawal@netapp.com",
  "vaibhavi@netapp.com",
  "romkar@netapp.com",
  "pankaj.kumar@netapp.com",
  "sesanshu.sahoo@netapp.com",
  "ankita.paul@netapp.com",
  "mmayur@netapp.com",
  "chaithra.valke@netapp.com",
  "sarushi@netapp.com",
  "vipinm@netapp.com",
  "singha@netapp.com",
  "ak@netapp.com",
  "dhanasekaran.j@netapp.com",
  "asudha@netapp.com",
  "gabrial.t@netapp.com",
  "singha@netapp.com",
  "ishwar.pandey@netapp.com",
];

sendEmails(recipients);
