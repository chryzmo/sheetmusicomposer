export const config = {
  // Width of the initial single-staff document in staff spaces.
  staffWidth: 40,
  // Visual ink width in staff spaces; not a recognition threshold.
  inkWidth: 0.12,
  // Preferred initial CSS pixels per staff space before fitting a narrow viewport.
  initialSpaceSize: 18,
  // Padding around the staff when fitting the initial view, in staff spaces.
  viewPadding: 2,
  // Minimum/maximum view scale in CSS pixels per staff space for pinch zoom.
  // These are display limits, not recognition or palm-rejection thresholds.
  minSpaceSize: 2,
  maxSpaceSize: 96,
  // Import safety limits: bound JSON file size and decoded ink allocations.
  maxBackupBytes: 10 * 1024 * 1024,
  maxStoredStrokes: 10000,
  maxStoredPoints: 1000000,
} as const;
