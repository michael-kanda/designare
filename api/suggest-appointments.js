// api/suggest-appointments.js - FINALE VERSION MIT 1 TERMIN PRO TAG REGEL

import { google } from 'googleapis';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        });

        const calendar = google.calendar({ version: 'v3', auth });

        const CONFIG = {
            workingHours: { start: 9, end: 17 },
            appointmentDuration: 60,
            preferredTimes: [9, 10, 11, 14, 15, 16], // Bevorzugte Stunden für den ersten Slot
            calendarId: 'designare.design@gmail.com',
            searchDaysLimit: 60 // Suche bis zu 60 Tage in die Zukunft
        };

        const holidays2025 = [
            '2025-01-01', '2025-01-06', '2025-04-21', '2025-05-01', 
            '2025-05-29', '2025-06-09', '2025-06-19', '2025-08-15', 
            '2025-10-26', '2025-11-01', '2025-12-08', '2025-12-25', '2025-12-26'
        ];

        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + CONFIG.searchDaysLimit);

        const eventsResponse = await calendar.events.list({
            calendarId: CONFIG.calendarId,
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const busyPeriods = eventsResponse.data.items.map(event => ({
            start: new Date(event.start.dateTime || `${event.start.date}T00:00:00`),
            end: new Date(event.end.dateTime || `${event.end.date}T23:59:59`),
        }));

        // ===================================================================
        // NEUE LOGIK: FINDE GENAU EINEN TERMIN PRO TAG
        // ===================================================================
        const availableSlots = [];
        let currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        currentDate.setDate(currentDate.getDate() + 1); // Starte die Suche immer ab morgen

        while (availableSlots.length < 3 && currentDate <= endDate) {
            // Schritt 1: Überspringe Wochenenden und Feiertage
            const dayOfWeek = currentDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const dateAsYYYYMMDD = currentDate.toISOString().split('T')[0];
            const isHoliday = holidays2025.includes(dateAsYYYYMMDD);

            if (isWeekend || isHoliday) {
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }

            // Schritt 2: Finde den ERSTEN freien Slot an diesem Tag
            let foundSlotForDay = null;
            for (let hour = CONFIG.workingHours.start; hour < CONFIG.workingHours.end; hour++) {
                const slotStart = new Date(currentDate);
                slotStart.setHours(hour, 0, 0, 0);
                const slotEnd = new Date(slotStart.getTime() + CONFIG.appointmentDuration * 60000);

                // Ignoriere Termine, die in der Vergangenheit liegen
                if (slotStart < new Date()) {
                    continue;
                }

                const isOverlapping = busyPeriods.some(busyPeriod =>
                    (slotStart < busyPeriod.end && slotEnd > busyPeriod.start)
                );

                if (!isOverlapping) {
                    // Erster freier Slot gefunden!
                    foundSlotForDay = {
                        start: { dateTime: slotStart.toISOString(), timeZone: 'Europe/Vienna' },
                        end: { dateTime: slotEnd.toISOString(), timeZone: 'Europe/Vienna' },
                    };
                    break; // Beende die Stundensuche für diesen Tag
                }
            }
            
            // Schritt 3: Wenn ein Slot gefunden wurde, speichere ihn und springe zum nächsten Tag
            if (foundSlotForDay) {
                availableSlots.push(foundSlotForDay);
            }

            // Gehe IMMER zum nächsten Tag, egal ob ein Slot gefunden wurde oder nicht
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        const nextThreeSlots = availableSlots.slice(0, 3);

        const isPreferredTime = (date) => CONFIG.preferredTimes.includes(date.getHours());
        const formattedSlots = nextThreeSlots.map((slot, index) => {
            const date = new Date(slot.start.dateTime);
            const formattedDatePart = date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
            const formattedTimePart = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const finalFormattedString = `${formattedDatePart} um ${formattedTimePart}`;
            return {
                slot: index + 1,
                fullDateTime: slot.start.dateTime,
                isPreferredTime: isPreferredTime(date),
                formattedString: finalFormattedString
            };
        });

        res.status(200).json({
            success: true,
            message: `Hier sind die nächsten ${formattedSlots.length} verfügbaren Termine:`,
            suggestions: formattedSlots,
        });

    } catch (error) {
        console.error('Fehler bei Terminvorschlägen:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Abrufen der Terminvorschläge.',
            error: error.message
        });
    }
}
