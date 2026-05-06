import { MailtrapClient } from "mailtrap";
const client = new MailtrapClient({
    testInboxId: 4473771,
    sandbox: true,
    token: process.env.MAILTRAP_SANDBOX_TOKEN,
});
export async function emailSend(props) {
    const { email, subject, text } = props;
    try {
        await client.send({
            from: { email: "test@infoblog.it", name: "Infoblog" },
            to: [{ email }],
            subject,
            text,
        });
    }
    catch (error) {
        console.log(error);
    }
}
