import { MailtrapClient } from "mailtrap";


type EmailSendProps = {
  email: string;
  subject: string;
  text: string;
}

const client = new MailtrapClient({
  testInboxId: 4473771,
  sandbox: true,
  token: process.env.MAILTRAP_SANDBOX_TOKEN!,
})

export async function emailSend(props: EmailSendProps) {
  const { email, subject, text } = props

  try {
    await client.send({
      from: { email: "test@infoblog.it", name: "Infoblog" },
      to: [{ email }],
      subject,
      text,
    })
  } catch (error) {
    console.log(error)
  }
}
