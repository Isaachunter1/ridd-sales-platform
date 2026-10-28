// The three RevHawk pulls behind account-integrity, run in parallel.
import { sql, getAccessToken, queryObjects } from '../../../config/bigquery.js';

const EDITS_SQL     = sql(import.meta.url, 'fetchCustomerEdits');
const CONTACTS_SQL  = sql(import.meta.url, 'fetchCustomerContacts');
const EMPLOYEES_SQL = sql(import.meta.url, 'fetchEmployeeContacts');

export async function fetchIntegrityRows({ editsStart, contactsStart }) {
  const token = await getAccessToken();
  const [edits, contacts, employees] = await Promise.all([
    queryObjects(token, EDITS_SQL, { start: editsStart }),
    queryObjects(token, CONTACTS_SQL, { start: contactsStart }),
    queryObjects(token, EMPLOYEES_SQL, {}),
  ]);
  return { edits, contacts, employees };
}
