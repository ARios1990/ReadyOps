# Recording and call-log import

In the existing agent booking page, use **Recording + call log**:

1. Upload the ReadyMode CSV call log.
2. Upload up to 20 recordings. Include the customer's phone number in each filename so it matches automatically. If a phone has several calls, select the correct call-log row.
3. Select the recording language (English or Spanish) for this batch, then select **Prepare forms automatically**.
4. Review the complete address, requested appointment, source fields, and warnings. Select **Fill booking form**, review the service questions, choose a live appointment slot, and submit.
5. Repeat for the next prepared customer. Submitted items are marked in the upload list.

The full Address field includes street, city, state, and ZIP. Imported bookings require all four components before submission. Conflicting dates, time windows, and contradictory recording/log statements require review. Unanswered questions remain blank.

Audio transcription runs in the browser using the existing Whisper worker. The first run downloads the model; long recordings can take several minutes. MP3, WAV, M4A, OGG, and WebM work when supported by the browser. An existing `.txt` transcript can be uploaded instead. If transcription fails, call-log details can still be reviewed and used.

Recordings are not uploaded by this import workflow. Reviewed notes are included with the booking; the complete transcript is saved to the internal QC transcript table after successful submission. If that save fails, keep the tab open and use **Retry saving transcript**. The endpoint requires both the appointment's management token and the browser session that submitted it, accepts only recent pending bookings, and does not overwrite transcripts saved by QC reviewers.

QC displays **Notes from the recording** in place of the automatic template note. Reviewers can select quoted passages, edit the notes after listening, save the transcript, and save lead changes. The full transcript remains internal.

Deployment requires the `preserve_recording_notes` migration, `save-booking-transcript` Edge Function, and the frontend build together. The Edge Function uses custom booking/session authentication, so its platform `verify_jwt` setting is false. Server credentials stay in Supabase environment variables.
