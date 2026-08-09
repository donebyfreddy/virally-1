/** A batch hold may settle only after every accepted provider job has a run. */
export function isBatchReservationComplete(
  linkedRunCount: number,
  expectedRunCount: number,
): boolean {
  return expectedRunCount > 0 && linkedRunCount >= expectedRunCount;
}
