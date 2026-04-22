import * as brevo from '@getbrevo/brevo';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { name, email, _subject, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({
                success: false,
                message: 'Bitte fülle alle Pflichtfelder aus.'
            });
        }

        const apiInstance = new brevo.TransactionalEmailsApi();
        apiInstance.setApiKey(
            brevo.TransactionalEmailsApiApiKeys.apiKey,
            process.env.BREVO_API_KEY
        );

        const sendSmtpEmail = new brevo.SendSmtpEmail();
        sendSmtpEmail.subject = _subject || `Neue Nachricht von ${name}`;
        sendSmtpEmail.to = [{ email: 'michael@designare.at', name: 'Michael Kanda' }];
        sendSmtpEmail.replyTo = { email: email, name: name };
        sendSmtpEmail.sender = { email: 'noreply@designare.at', name: 'Designare Kontaktformular' };
        sendSmtpEmail.htmlContent = `
            <h2>Neue Kontaktanfrage</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>E-Mail:</strong> ${email}</p>
            <p><strong>Betreff:</strong> ${_subject || 'Kein Betreff'}</p>
            <hr>
            <p><strong>Nachricht:</strong></p>
            <p>${message.replace(/\n/g, '<br>')}</p>
        `;

        await apiInstance.sendTransacEmail(sendSmtpEmail);

        return res.status(200).json({ success: true, message: 'Nachricht erfolgreich gesendet!' });

    } catch (error) {
        console.error('Brevo API Fehler:', error?.body || error?.message || error);
        return res.status(500).json({
            success: false,
            message: 'Fehler beim Senden. Bitte später erneut versuchen.'
        });
    }
}
