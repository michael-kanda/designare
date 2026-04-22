// /api/get-availability.js (VERBESSERTE VERSION mit präziser Slot-Erkennung)
import { google } from 'googleapis';

export default async function handler(req, res) {
    try {
        const { day: targetDay } = req.query;

        if (!targetDay) {
            return res.status(400).json({ success: false, message: "Ein Wochentag ist erforderlich (z.B. ?day=montag)." });
        }

        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        });

        const calendar = google.calendar({ version: 'v3', auth });

        // ===================================================================
        // KONFIGURATION
        // ===================================================================
        const CONFIG = {
            workingHours: { start: 9, end: 17 },
            appointmentDuration: 60, // Dauer in Minuten
            workingDays: ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'],
            dayMapping: { 'sonntag': 0, 'montag': 1, 'dienstag': 2, 'mittwoch': 3, 'donnerstag': 4, 'freitag': 5, 'samstag': 6 }
        };

        // ===================================================================
        // DATUM DES NÄCHSTEN GEWÜNSCHTEN WOCHENTAGS FINDEN
        // ===================================================================
        const targetDayNumber = CONFIG.dayMapping[targetDay.toLowerCase()];
        if (targetDayNumber === undefined) {
            return res.status(400).json({ success: false, message: `Ungültiger Wochentag: ${targetDay}` });
        }

        const nextTargetDate = new Date();
        nextTargetDate.setHours(0, 0, 0, 0);
        const todayNumber = nextTargetDate.getDay();
        let dayDifference = targetDayNumber - todayNumber;
        
        // WICHTIG: Falls heute der gewünschte Tag ist, schaue trotzdem nach verfügbaren Slots heute
        if (dayDifference < 0) {
            dayDifference += 7; // Nächste Woche
        } else if (dayDifference === 0) {
            // Heute - prüfe ob noch Slots verfügbar sind
            console.log(`Heute ist ${targetDay}, prüfe verfügbare Slots für heute`);
        }
        
        nextTargetDate.setDate(nextTargetDate.getDate() + dayDifference);

        // ===================================================================
        // TERMINE FÜR DIESEN TAG AUS GOOGLE CALENDAR ABRUFEN
        // ===================================================================
        const timeMin = new Date(nextTargetDate);
        timeMin.setHours(0, 0, 1, 0);

        const timeMax = new Date(nextTargetDate);
        timeMax.setHours(23, 59, 59, 0);

        console.log(`Suche Termine für ${targetDay} zwischen ${timeMin.toISOString()} und ${timeMax.toISOString()}`);

        const result = await calendar.events.list({
            calendarId: 'designare.design@gmail.com',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        console.log(`Gefundene Termine für ${targetDay}:`, result.data.items.length);
        
        const busySlots = result.data.items.map(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const end = new Date(event.end.dateTime || event.end.date);
            console.log(`Gebuchter Termin: ${start.toLocaleString('de-DE')} - ${end.toLocaleString('de-DE')} | ${event.summary}`);
            return { start, end };
        });

        // ===================================================================
        // VERFÜGBARE SLOTS FÜR DIESEN TAG GENERIEREN UND PRÜFEN
        // ===================================================================
        const availableSlots = [];
        const now = new Date();

        for (let hour = CONFIG.workingHours.start; hour < CONFIG.workingHours.end; hour++) {
            for (let minute = 0; minute < 60; minute += CONFIG.appointmentDuration) {
                const potentialSlotStart = new Date(nextTargetDate);
                potentialSlotStart.setHours(hour, minute, 0, 0);

                const potentialSlotEnd = new Date(potentialSlotStart.getTime() + CONFIG.appointmentDuration * 60000);

                console.log(`Prüfe Slot: ${potentialSlotStart.toLocaleString('de-DE')} - ${potentialSlotEnd.toLocaleString('de-DE')}`);

                // KRITISCHE VERBESSERUNG: Slot muss mindestens 30 Minuten in der Zukunft liegen
                const minimumFutureTime = new Date(now.getTime() + 30 * 60000); // 30 Minuten Vorlauf
                if (potentialSlotStart <= minimumFutureTime) {
                    console.log(`❌ Slot zu nah in der Zukunft: ${potentialSlotStart.toLocaleString('de-DE')} (Minimum: ${minimumFutureTime.toLocaleString('de-DE')})`);
                    continue;
                }

                // VERBESSERTE KONFLIKT-PRÜFUNG: Exakte Überschneidungserkennung
                let isBooked = false;
                for (const busy of busySlots) {
                    // Ein Slot ist belegt, wenn er mit einem bestehenden Termin überlappt
                    // Überlappung: (Start1 < Ende2) UND (Ende1 > Start2)
                    if (potentialSlotStart < busy.end && potentialSlotEnd > busy.start) {
                        console.log(`❌ Slot überlappt mit Termin: ${busy.start.toLocaleString('de-DE')} - ${busy.end.toLocaleString('de-DE')}`);
                        isBooked = true;
                        break;
                    }
                }

                if (!isBooked) {
                    console.log(`✅ Slot verfügbar: ${potentialSlotStart.toLocaleString('de-DE')}`);
                    availableSlots.push(formatSlotForDisplay(potentialSlotStart));
                }
            }
        }

        console.log(`Verfügbare Slots für ${targetDay}:`, availableSlots.length);

        res.status(200).json({
            success: true,
            day: targetDay,
            date: nextTargetDate.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' }),
            slots: availableSlots,
            debug: {
                searchDate: nextTargetDate.toISOString(),
                foundEvents: result.data.items.length,
                busySlots: busySlots.length,
                availableSlots: availableSlots.length
            }
        });

    } catch (error) {
        console.error("Fehler in get-availability:", error);
        res.status(500).json({ 
            success: false, 
            message: "Fehler beim Abrufen der Verfügbarkeit.",
            error: error.message
        });
    }
}

function formatSlotForDisplay(slotDate) {
    const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = slotDate.toLocaleDateString('de-DE', optionsDate);
    const timeStr = slotDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return {
        fullString: `${dateStr} um ${timeStr}`,
        time: timeStr,
        isoString: slotDate.toISOString() // Für Debug-Zwecke
    };
}
