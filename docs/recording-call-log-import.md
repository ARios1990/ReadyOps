# Recording and call-log import in QC

Open **QC Queue** and select **Show** on **Recording + call log**, beside the progress cards.

1. Upload the ReadyMode CSV call log and up to 20 recordings (or `.txt` transcripts). Phone numbers in filenames match log rows automatically; choose the row when multiple calls match.
2. Choose English or Spanish, then **Prepare forms automatically**.
3. Review addresses, recording passages, requested dates, and conflict warnings.
4. Select **Find QC lead to fill**. Choose the existing lead from matching phone-number results; results respect the signed-in reviewer's access and the selected company filter.
5. Review the populated QC form, then **Save Lead Information**. In Appointment Recording, review the imported transcript and select **Save Transcript** separately.

Imported addresses include street, city, state, and ZIP. Empty imported answers leave existing answers intact. Importing does not create, reschedule, approve, or send appointments. If no accessible lead matches, book the appointment through its company page first, then import it in QC.

Audio transcription runs in the browser using Whisper; the first run downloads a model. Long recordings may take several minutes. Recordings are not automatically uploaded by the importer. Full transcripts remain in the private QC transcript table under existing access policies.

The QC Calendar header remains visible during scrolling. **Show/Hide calendar** toggles the week cards, and **Show/Hide progress** toggles the summary metrics. The importer remains available and keeps its uploaded files when either section is hidden.

The importer is no longer displayed on public agent booking pages. The existing booking-transcript endpoint remains deployed for compatibility with older open booking sessions.
