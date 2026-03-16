export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "BorrowMyBike <support@borrowmybike.ca>",
      to: [to],
      subject,
      html,
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    console.error("Email send failed:", data);
    throw new Error(`Resend API error (${res.status})`);
  }

  return data;
}