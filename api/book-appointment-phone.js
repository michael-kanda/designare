// api/book-appointment-phone.js - MIT QR-CODE ICS FEATURE + E-Mail-Benachrichtigung
import { google } from 'googleapis';
import QRCode from 'qrcode';
import * as brevo from '@getbrevo/brevo';

// =================================================================
// E-MAIL-BENACHRICHTIGUNG
// =================================================================
async function sendBookingNotification({ name, phone, topic, startTime, endTime, eventId }) {
  try {
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    );

    // Manuelle Formatierung (Vercel hat oft keine de-AT Locale)
    const wochentage = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const monate = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    
    const pad = (n) => String(n).padStart(2, '0');
    const formattedDate = `${wochentage[startTime.getUTCDay()]}, ${pad(startTime.getUTCDate())}. ${monate[startTime.getUTCMonth()]} ${startTime.getUTCFullYear()}`;
    const formattedTime = `${pad(startTime.getUTCHours())}:${pad(startTime.getUTCMinutes())}`;
    const formattedEnd = `${pad(endTime.getUTCHours())}:${pad(endTime.getUTCMinutes())}`;

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `📞 Rückruf-Termin: ${name} – ${formattedDate}, ${formattedTime}`;
    sendSmtpEmail.to = [{ email: 'michael@designare.at', name: 'Michael Kanda' }];
    sendSmtpEmail.sender = { email: 'noreply@designare.at', name: 'Evita Terminbuchung' };
    sendSmtpEmail.htmlContent = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a1a;color:#fff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    
    <div style="text-align:center;padding:20px 0;border-bottom:1px solid #333;">
      <h1 style="margin:0;font-size:22px;color:#c4a35a;">📞 Neuer Rückruf-Termin</h1>
      <p style="margin:5px 0 0;color:#888;">Gebucht über Evita Chat-Assistent</p>
    </div>

    <div style="text-align:center;padding:25px 0;">
      <div style="display:inline-block;background:#1a1a2e;border:2px solid #c4a35a;border-radius:12px;padding:20px 30px;">
        <div style="font-size:24px;font-weight:bold;color:#c4a35a;">${formattedTime} – ${formattedEnd}</div>
        <div style="font-size:16px;color:#ccc;margin-top:6px;">${formattedDate}</div>
      </div>
    </div>

    <div style="background:#111;border-radius:8px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 15px;color:#c4a35a;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Kontaktdaten</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#888;width:100px;">Name:</td>
          <td style="padding:8px 0;color:#fff;font-weight:bold;font-size:16px;">${name}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#888;">Telefon:</td>
          <td style="padding:8px 0;">
            <a href="tel:${phone}" style="color:#c4a35a;font-weight:bold;font-size:16px;text-decoration:none;">${phone}</a>
          </td>
        </tr>
        ${topic ? `
        <tr>
          <td style="padding:8px 0;color:#888;vertical-align:top;">Anliegen:</td>
          <td style="padding:8px 0;color:#ccc;">${topic}</td>
        </tr>` : ''}
      </table>
    </div>

    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">⏰ Erinnerung</h3>
      <p style="margin:0;color:#ccc;font-size:13px;">Bitte 5–10 Minuten vor dem Termin <strong>${name}</strong> unter <a href="tel:${phone}" style="color:#c4a35a;">${phone}</a> anrufen.</p>
    </div>

    <div style="text-align:center;padding:15px 0;border-top:1px solid #333;color:#666;font-size:11px;">
      Gebucht am ${pad(new Date().getUTCDate())}.${pad(new Date().getUTCMonth()+1)}.${new Date().getUTCFullYear()} ${pad(new Date().getUTCHours())}:${pad(new Date().getUTCMinutes())} · Event-ID: ${eventId}<br>
      Evita AI-Assistent · designare.at
    </div>

  </div>
</body>
</html>`;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Rückruf-Benachrichtigung gesendet für ${name}`);

  } catch (error) {
    console.error('⚠️ E-Mail-Benachrichtigung fehlgeschlagen:');
    console.error('  Message:', error?.message);
    console.error('  Body:', JSON.stringify(error?.body || error?.response?.body || 'keine Details'));
  }
}

// =================================================================
// MAIN HANDLER
// =================================================================
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { slot, name, phone, topic } = req.body;

        console.log('Received phone booking data:', { slot, name, phone, topic });

        if (!slot || !name || !phone) {
            return res.status(400).json({ 
                success: false, 
                message: 'Fehlende Informationen. Slot, Name und Telefonnummer sind erforderlich.' 
            });
        }

        // Telefonnummer-Validierung
        const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,20}$/;
        if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
            return res.status(400).json({
                success: false,
                message: 'Bitte gib eine gültige Telefonnummer ein.'
            });
        }

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
        });

        const calendar = google.calendar({ version: 'v3', auth });

        // Slot-Parsing (ISO-Format erwarten)
        let startTime;
        try {
            startTime = new Date(slot);
            if (isNaN(startTime.getTime())) {
                throw new Error('Ungültiges Datumsformat');
            }
            console.log('Parsed appointment time:', startTime.toISOString());
        } catch (parseError) {
            console.error('Date parsing error:', parseError);
            return res.status(400).json({ 
                success: false, 
                message: `Das Datumsformat konnte nicht verarbeitet werden: ${slot}` 
            });
        }

        const endTime = new Date(startTime.getTime() + 60 * 60000); // 60 Minuten

        console.log('Event times:', {
            start: startTime.toISOString(),
            end: endTime.toISOString(),
            localStart: startTime.toLocaleString('de-DE'),
            localEnd: endTime.toLocaleString('de-DE')
        });

        // Doppelbuchungs-Prüfung
        console.log('Checking for conflicts...');
        
        const conflictCheck = await calendar.events.list({
            calendarId: 'designare.design@gmail.com',
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            singleEvents: true,
        });

        if (conflictCheck.data.items && conflictCheck.data.items.length > 0) {
            console.warn('Conflict detected:', conflictCheck.data.items[0].summary);
            return res.status(409).json({
                success: false,
                message: 'Dieser Termin ist leider bereits vergeben. Bitte wähle einen anderen Zeitpunkt.',
                conflict: conflictCheck.data.items[0].summary
            });
        }

        // Termin erstellen
        const event = {
            summary: `Rückruf: ${name}`,
            description: `Rückruf-Termin gebucht über Evita (Chat-Assistent) auf designare.at

KONTAKTDATEN:
Name: ${name}
Telefon: ${phone}
${topic ? `Anliegen: ${topic}` : ''}

BUCHUNGSDETAILS:
Gebucht am: ${new Date().toLocaleString('de-DE')}
Ursprünglicher Slot: ${startTime.toLocaleString('de-DE')}

NOTIZEN:
- Kunde wurde über Chat-System gebucht
- Bitte 5-10 Minuten vor dem Termin anrufen
- Bei Rückfragen: ${phone}

---
Automatisch erstellt durch Evita AI-Assistent`,
            
            start: {
                dateTime: startTime.toISOString(),
                timeZone: 'Europe/Vienna',
            },
            end: {
                dateTime: endTime.toISOString(),
                timeZone: 'Europe/Vienna',
            },
            
            // Erinnerungen
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 60 },
                    { method: 'popup', minutes: 15 },
                ]
            },
            
            // Zusätzliche Metadaten
            extendedProperties: {
                private: {
                    'booked_via': 'evita_chat',
                    'customer_phone': phone,
                    'booking_timestamp': new Date().toISOString(),
                    'booking_method': 'ai_chat_assistant'
                }
            },
            
            colorId: '2'
        };

        console.log('Creating calendar event for phone booking...');

        const result = await calendar.events.insert({
            calendarId: 'designare.design@gmail.com',
            resource: event,
            sendNotifications: false,
        });

        console.log('✅ Phone booking event created:', result.data.id);

        // ===================================================================
        // QR-CODE MIT ICS GENERIEREN
        // ===================================================================
        
        const formatICSDate = (date) => {
            return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        };
        
        const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//designare.at//Evita Booking//DE
BEGIN:VEVENT
UID:${result.data.id}@designare.at
DTSTART:${formatICSDate(startTime)}
DTEND:${formatICSDate(endTime)}
SUMMARY:Rückruf von Michael Kanda
DESCRIPTION:Telefonat mit designare.at${topic ? ' - ' + topic : ''}
LOCATION:Telefonat
END:VEVENT
END:VCALENDAR`;

        let qrCodeDataUrl = null;
        try {
            qrCodeDataUrl = await QRCode.toDataURL(icsContent, {
                width: 200,
                margin: 2,
                color: {
                    dark: '#c4a35a',
                    light: '#0a0a0a'
                }
            });
            console.log('✅ QR-Code generiert');
        } catch (qrError) {
            console.error('QR-Code Fehler:', qrError);
        }

        // ===================================================================
        // E-MAIL-BENACHRICHTIGUNG SENDEN
        // ===================================================================
        await sendBookingNotification({
            name,
            phone,
            topic,
            startTime,
            endTime,
            eventId: result.data.id
        });

        // ===================================================================
        // RESPONSE
        // ===================================================================
        
        res.status(200).json({ 
            success: true, 
            eventId: result.data.id,
            eventLink: result.data.htmlLink,
            qrCode: qrCodeDataUrl,
            icsContent: icsContent,
            appointmentDetails: {
                name: name,
                phone: phone,
                topic: topic || null,
                start: startTime.toISOString(),
                end: endTime.toISOString(),
                formattedDate: startTime.toLocaleDateString('de-AT', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                }),
                formattedTime: startTime.toLocaleTimeString('de-AT', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                })
            }
        });

    } catch (error) {
        console.error("Fehler bei Telefon-Terminbuchung:", error);
        
        let errorMessage = 'Ups, da ist etwas schiefgelaufen. Die Terminbuchung konnte nicht abgeschlossen werden.';
        
        if (error.code === 409) {
            errorMessage = 'Dieser Zeitslot ist bereits belegt. Bitte wähle einen anderen Termin.';
        } else if (error.message && error.message.includes('parse')) {
            errorMessage = 'Das Datumsformat konnte nicht verarbeitet werden. Bitte versuche es erneut.';
        }
        
        res.status(500).json({ 
            success: false, 
            message: errorMessage,
            error: error.message
        });
    }
}
