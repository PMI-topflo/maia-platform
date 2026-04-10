export async function POST(req: Request) {
  const body = await req.json();

  console.log("Incoming message:", JSON.stringify(body));

  const message =
    body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message) {
    return new Response("No message", { status: 200 });
  }

  const from = message.from;
  const text = message.text?.body;

  console.log("From:", from);
  console.log("Text:", text);

  await fetch(`https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer YOUR_ACCESS_TOKEN`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: from,
      text: { body: "Received your message 👍" },
    }),
  });

  return new Response("OK", { status: 200 });
}git add .
git commit -m "Webhook reply working"
git push
