import { isValidPhoneNumber } from 'libphonenumber-js';
import type { Rng } from './rng';

/**
 * Client identities for the demo: Lebanese-style FIRST + LAST names and phone numbers. No e-mail is ever produced
 * (Client.email stays NULL: a made-up address would make the e-mail service try to send and bounce).
 *
 * Phones are plausible, NOT guaranteed unassigned: they are valid E.164 mobile numbers for region LB drawn from one
 * fixed block (subscriber digits start with 77). Never send WhatsApp to them.
 */

export const FIRST_NAMES: readonly string[] = [
  // women
  'Lina', 'Maya', 'Nadine', 'Rana', 'Tala', 'Sara', 'Dina', 'Rima', 'Layal', 'Nour',
  'Joelle', 'Carla', 'Micheline', 'Hala', 'Yara', 'Dalia', 'Rouba', 'Zeina', 'Hiba', 'Mira',
  'Christelle', 'Sandy', 'Tamara', 'Reem', 'Lara', 'Jana', 'Noura', 'Farah', 'Ghada', 'Hanan',
  'Samar', 'Rola', 'Aya', 'Lama', 'Maria', 'Josephine', 'Rita', 'Cynthia', 'Elsa', 'Nisrine',
  'Amal', 'Suzanne', 'Najwa', 'Salma', 'Leila', 'Mona', 'Dima', 'Rawan', 'Carine', 'Pamela',
  // men
  'Rami', 'Karim', 'Georges', 'Elie', 'Jad', 'Hadi', 'Fadi', 'Walid', 'Tony', 'Charbel',
  'Rabih', 'Ziad', 'Bassel', 'Omar', 'Ali', 'Hassan', 'Mahmoud', 'Khaled', 'Samir', 'Nabil',
  'Joseph', 'Antoine', 'Michel', 'Pierre', 'Elias', 'Nader', 'Wissam', 'Imad', 'Tarek', 'Ghassan',
  'Majd', 'Anis', 'Raed', 'Sami', 'Jihad', 'Marwan', 'Rafic', 'Bilal', 'Mohamad', 'Youssef',
  'Wael', 'Habib', 'Roger', 'Edgar', 'Patrick', 'Kamal', 'Nizar', 'Hussein', 'Jamil', 'Adnan',
  'Ramzi', 'Toufic', 'Ibrahim', 'Mazen', 'Sleiman', 'Fouad', 'Ahmad', 'Raja', 'Dany', 'Ralph',
];

export const SURNAMES: readonly string[] = [
  'Haddad', 'Khoury', 'Nasser', 'Saab', 'Awad', 'Daher', 'Hamdan', 'Mansour', 'Fares', 'Aoun',
  'Chahine', 'Karam', 'Rizk', 'Sleiman', 'Hakim', 'Younes', 'Abboud', 'Salameh', 'Gerges', 'Tannous',
  'Bitar', 'Hobeika', 'Zein', 'Moussa', 'Ghanem', 'Issa', 'Nehme', 'Azar', 'Daou', 'Fakhoury',
  'Jaber', 'Kassem', 'Makhoul', 'Naccache', 'Raad', 'Saliba', 'Taha', 'Wehbe', 'Yazbek', 'Zaki',
  'Barakat', 'Chidiac', 'Doumit', 'Farhat', 'Ghosn', 'Harb', 'Itani', 'Jreij', 'Khalil', 'Lahoud',
  'Matar', 'Najjar', 'Obeid', 'Osman', 'Qassem', 'Rahal', 'Sabbagh', 'Tabet', 'Yammine', 'Zahar',
  'Nader', 'Jaoude', 'Hage', 'Khatib', 'Sayegh', 'Sfeir', 'Shami', 'Slim', 'Touma', 'Atallah',
  'Boustany', 'Chamoun', 'Dib', 'Eid', 'Frem', 'Hayek', 'Kanaan', 'Maalouf', 'Nakhle', 'Rahme',
];

/**
 * Full names of well-known people (politicians, singers, designers, actors, athletes) that the random mix could
 * produce. Matching is case-insensitive on the whole name. Extend freely.
 */
export const BLOCKED_FULL_NAMES: readonly string[] = [
  'Elie Saab', 'Michel Aoun', 'Joseph Aoun', 'Rafic Hariri', 'Walid Jumblatt', 'Samir Geagea',
  'Nabih Berri', 'Hassan Nasrallah', 'Najib Mikati', 'Amin Gemayel', 'Pierre Gemayel', 'Sleiman Frangieh',
  'Michel Sleiman', 'Fouad Siniora', 'Rafic Harb', 'Riad Salameh', 'Elissa Khoury', 'Marwan Khoury',
  'Nancy Ajram', 'Haifa Wehbe', 'Wael Kfoury', 'Ragheb Alama', 'Melhem Zein', 'Fadel Shaker',
  'Georges Khabbaz', 'Ziad Rahbani', 'Majida Roumi', 'Charbel Khalil', 'Tony Hanna', 'Ghassan Saliba',
  'Nadine Labaki', 'Nadine Njeim', 'Carole Samaha', 'Maya Diab', 'Ali Hamdan', 'Hassan Diab',
  'Samir Nasser', 'Fares Said', 'Walid Toufic', 'Wael Jassar', 'Elie Khoury', 'Joseph Khoury', 'Ziad Baroud',
  'Karim Wehbe', 'Mohamad Safa', 'Rabih Haddad', 'Tala Hamdan', 'Dalia Haddad', 'Wissam Hadad',
].filter((n, i, all) => all.indexOf(n) === i);

/** Mobile prefixes of Lebanon: 03 (national form '3...') and 70, 71, 76, 78, 79, 81. */
const PREFIXES = ['3', '70', '71', '76', '78', '79', '81'] as const;
/** The fixed fake block: the six subscriber digits start with these two. */
const BLOCK = '77';

export interface ClientIdentity {
  name: string;
  /** E.164, valid for LB. */
  phone: string;
}

const isMobileLb = (e164: string): boolean => isValidPhoneNumber(e164, 'LB');

/**
 * `count` distinct identities. `usedPhones` is shared across calls so numbers stay unique across businesses and
 * `usedNames` (optional) keeps full names unique per call only. Blocklisted names are skipped.
 */
export function generateClientIdentities(
  rng: Rng,
  count: number,
  usedPhones: Set<string>,
  perBusinessNamesUnique = true,
): ClientIdentity[] {
  const blocked = new Set(BLOCKED_FULL_NAMES.map((n) => n.toLowerCase()));
  const names = new Set<string>();
  const out: ClientIdentity[] = [];
  let guard = 0;
  while (out.length < count) {
    if (++guard > count * 200 + 1000) throw new Error('could not generate enough identities');
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(SURNAMES);
    const name = `${first} ${last}`;
    const key = name.toLowerCase();
    if (blocked.has(key)) continue;
    if (perBusinessNamesUnique && names.has(key)) continue;
    const prefix = rng.pick(PREFIXES);
    const tail = String(rng.int(0, 9999)).padStart(4, '0');
    const phone = `+961${prefix}${BLOCK}${tail}`;
    if (usedPhones.has(phone) || !isMobileLb(phone)) continue;
    names.add(key);
    usedPhones.add(phone);
    out.push({ name, phone });
  }
  return out;
}
