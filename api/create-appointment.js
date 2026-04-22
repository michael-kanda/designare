// api/create-appointment.js - VERBESSERTE VERSION + E-Mail-Benachrichtigung
import { google } from 'googleapis';
import * as brevo from '@getbrevo/brevo';

// =================================================================
// E-MAIL-BENACHRICHTIGUNG
// =================================================================
async function sendBookingNotification({ name, email, startTime, endTime, eventId, originalSlot }) {
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
    sendSmtpEmail.subject = `💬 Beratungstermin: ${name} – ${formattedDate}, ${formattedTime}`;
    sendSmtpEmail.to = [{ email: 'michael@designare.at', name: 'Michael Kanda' }];
    sendSmtpEmail.sender = { email: 'noreply@designare.at', name: 'Evita Terminbuchung' };
    sendSmtpEmail.htmlContent = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a1a;color:#fff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    
    <div style="text-align:center;padding:20px 0;border-bottom:1px solid #333;">
      <h1 style="margin:0;font-size:22px;color:#c4a35a;">💬 Neuer Beratungstermin</h1>
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
          <td style="padding:8px 0;color:#888;">E-Mail:</td>
          <td style="padding:8px 0;">
            <a href="mailto:${email}" style="color:#c4a35a;font-weight:bold;font-size:16px;text-decoration:none;">${email}</a>
          </td>
        </tr>
      </table>
    </div>

    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">💡 Nächster Schritt</h3>
      <p style="margin:0;color:#ccc;font-size:13px;">Kontaktiere <strong>${name}</strong> per E-Mail unter <a href="mailto:${email}" style="color:#c4a35a;">${email}</a> für weitere Details zum Beratungsgespräch.</p>
    </div>

    <div style="text-align:center;padding:15px 0;border-top:1px solid #333;color:#666;font-size:11px;">
      Gebucht am ${pad(new Date().getUTCDate())}.${pad(new Date().getUTCMonth()+1)}.${new Date().getUTCFullYear()} ${pad(new Date().getUTCHours())}:${pad(new Date().getUTCMinutes())} · Event-ID: ${eventId}<br>
      Evita AI-Assistent · designare.at
    </div>

  </div>
</body>
</html>`;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Beratungstermin-Benachrichtigung gesendet für ${name}`);

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
    const { slot, name, email } = req.body;

    console.log('Received appointment data:', { slot, name, email });

    if (!slot || !name || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Fehlende Informationen. Slot, Name und E-Mail sind erforderlich.' 
      });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });

    const calendar = google.calendar({ version: 'v3', auth });

    // ===================================================================
    // VERBESSERTE DEUTSCHE DATUM-PARSING FUNKTION
    // ===================================================================
    function parseGermanDate(slotString) {
      console.log('Parsing German date:', slotString);
      
      let cleanedSlot = slotString.replace(/\s+um\s+/, ' ').trim();
      
      const germanDays = {
        'montag': 'monday',
        'dienstag': 'tuesday', 
        'mittwoch': 'wednesday',
        'donnerstag': 'thursday',
        'freitag': 'friday',
        'samstag': 'saturday',
        'sonntag': 'sunday'
      };
      
      const germanMonths = {
        'januar': 'january',
        'februar': 'february',
        'märz': 'march',
        'april': 'april',
        'mai': 'may',
        'juni': 'june',
        'juli': 'july',
        'august': 'august',
        'september': 'september',
        'oktober': 'october',
        'november': 'november',
        'dezember': 'december'
      };
      
      let englishSlot = cleanedSlot.toLowerCase();
      
      Object.keys(germanDays).forEach(german => {
        englishSlot = englishSlot.replace(german, germanDays[german]);
      });
      
      Object.keys(germanMonths).forEach(german => {
        englishSlot = englishSlot.replace(german, germanMonths[german]);
      });
      
      console.log('Converted to English:', englishSlot);
      
      const regex1 = /(\w+),?\s*(\d{1,2})\.\s*(\w+)\s*(\d{4}),?\s*(\d{1,2}):(\d{2})/i;
      const match1 = englishSlot.match(regex1);
      
      if (match1) {
        const [, dayName, day, month, year, hour, minute] = match1;
        const dateString = `${month} ${day}, ${year} ${hour}:${minute}:00`;
        console.log('Parsed dateString:', dateString);
        
        const parsedDate = new Date(dateString);
        if (!isNaN(parsedDate.getTime())) {
          console.log('Successfully parsed:', parsedDate.toISOString());
          return parsedDate;
        }
      }
      
      throw new Error(`Konnte Datum nicht parsen: ${slotString}`);
    }

    // Parse das Datum
    let startTime;
    try {
      startTime = parseGermanDate(slot);
      console.log('Successfully parsed appointment time:', startTime.toISOString());
    } catch (parseError) {
      console.error('Date parsing error:', parseError);
      return res.status(400).json({ 
        success: false, 
        message: `Das Datumsformat konnte nicht verarbeitet werden: ${slot}` 
      });
    }

    const endTime = new Date(startTime.getTime() + 60 * 60000);

    console.log('Event times:', {
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      localStart: startTime.toLocaleString('de-DE'),
      localEnd: endTime.toLocaleString('de-DE')
    });

    // ===================================================================
    // ERWEITERTE DOPPELBUCHUNGS-PRÜFUNG
    // ===================================================================
    console.log('Checking for conflicts in extended time range...');
    
    const bufferMinutes = 15;
    const extendedStart = new Date(startTime.getTime() - bufferMinutes * 60000);
    const extendedEnd = new Date(endTime.getTime() + bufferMinutes * 60000);
    
    const conflictCheck = await calendar.events.list({
      calendarId: 'designare.design@gmail.com',
      timeMin: extendedStart.toISOString(),
      timeMax: extendedEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    console.log(`Found ${conflictCheck.data.items.length} existing events in extended range`);

    const conflicts = conflictCheck.data.items.filter(event => {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventEnd = new Date(event.end.dateTime || event.end.date);
      const hasOverlap = startTime < eventEnd && endTime > eventStart;
      if (hasOverlap) {
        console.log(`❌ CONFLICT DETECTED with event: ${event.summary}`);
      }
      return hasOverlap;
    });

    if (conflicts.length > 0) {
      console.warn('Appointment conflict detected:', conflicts.map(c => c.summary));
      return res.status(409).json({
        success: false,
        message: 'Dieser Termin ist leider bereits vergeben oder überlappt mit einem bestehenden Termin. Bitte wähle einen anderen Slot.',
        conflicts: conflicts.map(c => ({
          summary: c.summary,
          start: c.start.dateTime,
          end: c.end.dateTime
        }))
      });
    }
    
    console.log('✅ No conflicts found. Proceeding to create appointment.');

    // ===================================================================
    // TERMIN ERSTELLEN
    // ===================================================================
    const event = {
      summary: `Beratungsgespräch: ${name}`,
      description: `Termin gebucht über Evita auf designare.at.\n\nKontaktdaten:\nName: ${name}\nE-Mail: ${email}\n\nUrsprünglicher Slot: ${slot}\n\nGebucht am: ${new Date().toLocaleString('de-DE')}\n\nHinweis: Bitte kontaktiere den Kunden per E-Mail für weitere Details.`,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'Europe/Vienna',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'Europe/Vienna',
      },
      reminders: { 'useDefault': true },
      extendedProperties: {
        private: {
          'booked_via': 'evita_ai',
          'customer_email': email,
          'booking_timestamp': new Date().toISOString()
        }
      }
    };

    console.log('Creating calendar event...');

    const result = await calendar.events.insert({
      calendarId: 'designare.design@gmail.com',
      resource: event,
      sendNotifications: false,
    });

    console.log('✅ Calendar event created successfully:', result.data.id);

    // Verifikation
    const verificationCheck = await calendar.events.get({
      calendarId: 'designare.design@gmail.com',
      eventId: result.data.id
    });

    if (verificationCheck.data) {
      console.log('✅ Appointment verified in calendar');
    }

    // ===================================================================
    // E-MAIL-BENACHRICHTIGUNG SENDEN
    // ===================================================================
    await sendBookingNotification({
      name,
      email,
      startTime,
      endTime,
      eventId: result.data.id,
      originalSlot: slot
    });

    res.status(200).json({ 
      success: true, 
      message: `Dein Termin wurde erfolgreich gebucht! Der Termin für ${name} (${email}) am ${slot} wurde in den Kalender eingetragen. Michael wird sich in Kürze per E-Mail bei Dir melden.`,
      eventId: result.data.id,
      eventLink: result.data.htmlLink,
      customerInfo: { name, email, slot },
      appointmentDetails: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        localTime: `${startTime.toLocaleString('de-DE')} - ${endTime.toLocaleString('de-DE')}`
      }
    });

  } catch (error) {
    console.error("Fehler in create-appointment:", error);
    
    let errorMessage = 'Ups, da ist etwas schiefgelaufen. Die Terminbuchung konnte nicht abgeschlossen werden.';
    
    if (error.message && error.message.includes('Domain-Wide Delegation')) {
      errorMessage = 'Kalender-Konfigurationsproblem. Bitte kontaktiere Michael direkt.';
    } else if (error.message && error.message.includes('parse')) {
      errorMessage = 'Das Datumsformat konnte nicht verarbeitet werden. Bitte versuche es erneut.';
    } else if (error.code === 409) {
      errorMessage = 'Dieser Zeitslot ist bereits belegt. Bitte wähle einen anderen Termin.';
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
