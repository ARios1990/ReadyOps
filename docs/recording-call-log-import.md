# Recording and call-log import in QC

Open **QC Queue** and select **Show** on **Recording + call log**, beside the progress cards.

1. Upload the ReadyMode CSV call log and up to 20 recordings (or `.txt` transcripts). Phone numbers in filenames match log rows automatically; choose the row when multiple calls match.
2. Choose English or Spanish, then **Prepare forms automatically**.
3. Review addresses, recording passages, requested dates, and conflict warnings.
4. To update an existing lead, select **Find QC lead to fill**. Choose the existing lead from matching phone-number results; results respect the signed-in reviewer's access and the selected company filter.
5. Review the populated QC form, then **Save Lead Information**. In Appointment Recording, review the imported transcript and select **Save Transcript** separately.

Imported addresses include street, city, state, and ZIP. Empty imported answers leave existing answers intact. Filling an existing review does not create, reschedule, approve, or send appointments. To create a new appointment, select **Create new appointment** on a prepared call, choose a company and agent, and open the prefilled booking form. Review the warnings, choose a live available slot, complete required fields, and confirm. The new lead enters Pending QC; recording notes accompany the lead and its transcript is saved privately. If transcript saving fails, retry it in the confirmation without creating a second appointment. The complete street, city, state, and ZIP are required.

Audio transcription runs in the browser using Whisper; the first run downloads a model. Long recordings may take several minutes. Recordings are not automatically uploaded by the importer. Full transcripts remain in the private QC transcript table under existing access policies.

The QC Calendar header remains visible during scrolling. **Show/Hide calendar** toggles the week cards, and **Show/Hide progress** toggles the summary metrics. The importer remains available and keeps its uploaded files when either section is hidden.

The importer is no longer displayed on public agent booking pages. The existing booking-transcript endpoint remains deployed for compatibility with older open booking sessions.

Roofing **Service Requested** is a required single-choice dropdown with Select Service as its placeholder. Values continue to save as `service_needed`; saved choices preselect, and legacy saved services remain selected as a disabled legacy option until the agent chooses a current option. Unresolved ReadyMode profile variables are ignored. **Signed with another contractor?** defaults to No, remains visible, and can be changed to Yes; it still saves as `contract`.
