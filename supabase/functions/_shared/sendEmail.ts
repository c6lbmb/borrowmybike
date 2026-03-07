import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

export async function sendEmail({
  to,
  subject,
  html
}: {
  to: string;
  subject: string;
  html: string;
}) {

  const { data, error } = await resend.emails.send({
    from: "BorrowMyBike <support@borrowmybike.ca>",
    to: [to],
    subject,
    html
  });

  if (error) {
    console.error("Email send failed:", error);
    throw error;
  }

  return data;
}