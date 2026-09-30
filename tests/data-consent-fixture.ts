import path from 'node:path';
import {
  dataConsentPurposes,
  dataConsentVersion,
  type DataConsentPurpose,
} from '../src/host/data-consent';
import { writeLocalJson } from '../src/host/local-json';

/** Unrelated suites seed a current receipt in their disposable device, without skipping host checks. */
export async function seedDataConsent(
  dataDir: string,
  purposes: readonly DataConsentPurpose[] = dataConsentPurposes,
) {
  const accepted = Object.fromEntries(
    purposes.map((purpose) => [purpose, new Date().toISOString()]),
  );
  await writeLocalJson(path.join(dataDir, 'data-consent.json'), {
    version: dataConsentVersion,
    accepted,
  });
}
