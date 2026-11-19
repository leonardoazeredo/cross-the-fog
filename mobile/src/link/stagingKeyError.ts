/**
 * The phone's staging Keystore entry cannot be used (invalidated or unrecoverable). Nothing was
 * deleted and no new entry was made, so the staged walks stay and the watch keeps its copies;
 * unlike a storage failure, a retry cannot help until the entry works again.
 */
export class StagingKeyUnusableError extends Error {
  override name = "StagingKeyUnusableError";
}
