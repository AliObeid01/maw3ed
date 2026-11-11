import type { BusinessArea, BusinessCategory } from '../../src/lib/business/profile';

/**
 * The demo businesses. ALL of this is simulated: names are fictional and descriptive (no personal names, no known
 * brands), addresses are street/neighbourhood names without building numbers, staff have first names only.
 * Changing a slug here changes what `demo:remove` deletes: slugs are the only handle the tools use.
 */

/** 0 = Sunday ... 6 = Saturday; each value is a list of local [start, end] intervals (HH:mm). */
export type WeeklyHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, [string, string][]>>;

export interface ServiceSpec {
  name: string;
  durationMin: number;
  /** Only 0 or 15, so appointments stay on the 15-minute grid. */
  bufferMin: 0 | 15;
  /** USD. */
  price: number;
}

export interface StaffSpec {
  /** First name only. */
  name: string;
  /** Service names this person performs. */
  services: string[];
  /** Overrides the business hours (part-time clinicians). */
  hours?: WeeklyHours;
  colour: string;
}

export interface BusinessSpec {
  slug: string;
  name: string;
  category: Exclude<BusinessCategory, 'other'>;
  area: Exclude<BusinessArea, 'other'>;
  address: string;
  locale: 'en' | 'ar';
  /** true: a generated logo is stored; false: the app shows initials. */
  logo: boolean;
  flagship?: boolean;
  services: ServiceSpec[];
  staff: StaffSpec[];
  hours: WeeklyHours;
  /** Number of clients (flagship ~140, others 8 to 25). */
  clients: number;
  /** Target number of appointments in the last four weeks (lighter businesses only). */
  pastAppointments: number;
}

const COLOURS = ['#2864F5', '#21CDB3', '#254EDB', '#43C4F0', '#0B1938', '#5B7CFA', '#14B8A6', '#6D8DF7'];

const days = (list: (1 | 2 | 3 | 4 | 5 | 6 | 0)[], intervals: [string, string][]): WeeklyHours =>
  Object.fromEntries(list.map((d) => [d, intervals]));

const CLINIC_HOURS: WeeklyHours = {
  ...days([1, 2, 3, 4, 5], [['09:00', '13:00'], ['14:00', '18:00']]),
  6: [['09:00', '14:00']],
};
const SALON_HOURS: WeeklyHours = {
  ...days([1, 2, 3, 4, 5], [['10:00', '19:00']]),
  6: [['09:00', '17:00']],
};
const BARBER_HOURS: WeeklyHours = {
  ...days([1, 2, 3, 4, 5], [['09:00', '20:00']]),
  6: [['09:00', '18:00']],
};
const SPA_HOURS: WeeklyHours = {
  ...days([1, 2, 3, 4, 5], [['10:00', '20:00']]),
  6: [['10:00', '18:00']],
};

const svc = (name: string, durationMin: number, price: number, bufferMin: 0 | 15 = 0): ServiceSpec => ({
  name,
  durationMin,
  price,
  bufferMin,
});
const all = (services: ServiceSpec[]) => services.map((s) => s.name);

const barberServices = (haircut: number, beard: number, combo: number): ServiceSpec[] => [
  svc('Haircut', 30, haircut),
  svc('Beard trim', 15, beard),
  svc('Haircut and beard', 45, combo),
  svc('Kids haircut', 30, Math.max(6, haircut - 4)),
  svc('Hot towel shave', 30, beard + 3),
];
const salonServices = (cut: number, colour: number): ServiceSpec[] => [
  svc("Women's haircut", 45, cut),
  svc("Men's haircut", 30, Math.round(cut * 0.6)),
  svc('Blow dry', 30, Math.round(cut * 0.6)),
  svc('Root colour', 90, colour, 15),
  svc('Highlights', 90, colour * 2, 15),
  svc('Keratin treatment', 90, colour * 2 + 30, 15),
];
const spaServices = (base: number): ServiceSpec[] => [
  svc('Swedish massage', 60, base),
  svc('Deep tissue massage', 60, base + 20),
  svc('Hot stone massage', 75, base + 15, 15),
  svc('Aromatherapy massage', 60, base + 5),
  svc('Foot reflexology', 30, base - 15),
  svc('Moroccan bath', 45, base - 10),
];
const physioServices = (session: number): ServiceSpec[] => [
  svc('Physiotherapy session', 45, session),
  svc('Initial assessment', 60, session + 10),
  svc('Sports massage therapy', 45, session + 5),
  svc('Back pain program session', 45, session),
  svc('Kinesiology taping', 30, session - 15),
];
const beautyServices = (facial: number, laser: number): ServiceSpec[] => [
  svc('Skin consultation', 30, 25),
  svc('Hydrating facial', 60, facial),
  svc('Chemical peel', 45, facial + 20, 15),
  svc('Laser hair removal, small area', 30, laser, 15),
  svc('Laser hair removal, full legs', 60, laser + 60, 15),
  svc('Microneedling session', 60, facial + 45, 15),
];

const flagshipServices: ServiceSpec[] = [
  svc('Check-up and cleaning', 45, 35),
  svc('Filling', 45, 60, 15),
  svc('Root canal treatment', 90, 140, 15),
  svc('Teeth whitening', 60, 150, 15),
  svc('Braces consultation', 30, 25),
  svc('Emergency visit', 30, 30, 15),
];

const staff = (name: string, services: string[], i: number, hours?: WeeklyHours): StaffSpec => ({
  name,
  services,
  colour: COLOURS[i % COLOURS.length] as string,
  ...(hours ? { hours } : {}),
});

const barber1 = barberServices(12, 7, 18);
const barber2 = barberServices(10, 6, 14);
const barber3 = barberServices(13, 8, 20);
const salon1 = salonServices(25, 45);
const salon2 = salonServices(20, 40);
const salon3 = salonServices(28, 50);
const dental2: ServiceSpec[] = [
  svc('Check-up and cleaning', 45, 30),
  svc('Filling', 45, 50, 15),
  svc('Teeth whitening', 60, 120, 15),
  svc('Emergency visit', 30, 25, 15),
];
const dental3: ServiceSpec[] = [
  svc('Check-up and cleaning', 45, 25),
  svc('Filling', 45, 45, 15),
  svc('Braces consultation', 30, 20),
  svc('Emergency visit', 30, 25, 15),
  svc('Root canal treatment', 90, 120, 15),
];
const beauty1 = beautyServices(60, 60);
const beauty2 = beautyServices(45, 50).slice(0, 5);
const beauty3 = beautyServices(50, 55).slice(0, 4);
const spa1 = spaServices(60);
const spa2 = spaServices(50).slice(0, 5);
const spa3 = spaServices(65);
const physio1 = physioServices(40);
const physio2 = physioServices(35).slice(0, 4);
const physio3 = physioServices(38).slice(0, 4);

export const FLAGSHIP_SLUG = 'cedar-smile-dental-clinic';

export const MANIFEST: readonly BusinessSpec[] = [
  // Barbers
  {
    slug: 'cedar-barber-lounge', name: 'Cedar Barber Lounge', category: 'barbers', area: 'beirut',
    address: 'Mar Mikhael Street, Beirut', locale: 'en', logo: true, services: barber1,
    staff: [staff('Hadi', all(barber1), 0), staff('Jad', all(barber1), 1)],
    hours: BARBER_HOURS, clients: 24, pastAppointments: 44,
  },
  {
    slug: 'olive-branch-barbers', name: 'Olive Branch Barbers', category: 'barbers', area: 'sidon',
    address: 'Riad El Solh Street, Sidon', locale: 'ar', logo: false, services: barber2.slice(0, 4),
    staff: [staff('Omar', all(barber2.slice(0, 4)), 2)],
    hours: BARBER_HOURS, clients: 14, pastAppointments: 28,
  },
  {
    slug: 'phoenician-gents-barbershop', name: 'Phoenician Gents Barbershop', category: 'barbers', area: 'tripoli',
    address: 'Al Mina Road, Tripoli', locale: 'en', logo: true, services: barber3.slice(0, 4),
    staff: [staff('Wissam', all(barber3.slice(0, 4)), 3)],
    hours: BARBER_HOURS, clients: 18, pastAppointments: 34,
  },
  // Hair salons
  {
    slug: 'skyline-hair-studio', name: 'Skyline Hair Studio', category: 'hair-salons', area: 'jounieh',
    address: 'Kaslik Main Road, Jounieh', locale: 'en', logo: true, services: salon1,
    staff: [staff('Joelle', all(salon1), 4), staff('Carla', all(salon1).slice(0, 5), 5)],
    hours: SALON_HOURS, clients: 22, pastAppointments: 36,
  },
  {
    slug: 'levant-hair-atelier', name: 'Levant Hair Atelier', category: 'hair-salons', area: 'zahle',
    address: 'Zahle Main Boulevard, Zahle', locale: 'ar', logo: true, services: salon2.slice(0, 4),
    staff: [staff('Maria', all(salon2.slice(0, 4)), 6)],
    hours: SALON_HOURS, clients: 12, pastAppointments: 24,
  },
  {
    slug: 'mediterranean-hair-lounge', name: 'Mediterranean Hair Lounge', category: 'hair-salons', area: 'beirut',
    address: 'Verdun Street, Beirut', locale: 'en', logo: true, services: salon3,
    staff: [staff('Layal', all(salon3), 7), staff('Dina', all(salon3).slice(1), 0)],
    hours: SALON_HOURS, clients: 25, pastAppointments: 42,
  },
  // Dental clinics (the flagship is the first)
  {
    slug: FLAGSHIP_SLUG, name: 'Cedar Smile Dental Clinic', category: 'dental-clinics', area: 'beirut',
    address: 'Hamra Street, Beirut', locale: 'en', logo: true, flagship: true, services: flagshipServices,
    staff: [
      staff('Rami', all(flagshipServices), 0, {
        1: [['09:00', '13:00'], ['14:00', '18:00']],
        3: [['09:00', '13:00'], ['14:00', '18:00']],
        5: [['09:00', '13:00'], ['14:00', '18:00']],
        6: [['09:00', '14:00']],
      }),
      staff('Lina', all(flagshipServices).filter((n) => n !== 'Root canal treatment'), 1, {
        2: [['09:00', '13:00'], ['14:00', '18:00']],
        4: [['09:00', '13:00'], ['14:00', '18:00']],
        6: [['09:00', '14:00']],
      }),
      staff('Karim', ['Check-up and cleaning', 'Filling', 'Root canal treatment', 'Braces consultation', 'Emergency visit'], 2, {
        1: [['14:00', '18:00']],
        2: [['14:00', '18:00']],
        3: [['14:00', '18:00']],
        4: [['14:00', '18:00']],
        5: [['14:00', '18:00']],
      }),
      staff('Maya', ['Check-up and cleaning', 'Teeth whitening'], 3, {
        2: [['09:00', '13:00']],
        3: [['09:00', '13:00']],
        4: [['09:00', '13:00']],
        5: [['09:00', '13:00']],
      }),
    ],
    hours: CLINIC_HOURS, clients: 140, pastAppointments: 0,
  },
  {
    slug: 'phoenician-dental-studio', name: 'Phoenician Dental Studio', category: 'dental-clinics', area: 'tyre',
    address: 'Tyre Seafront Road, Tyre', locale: 'en', logo: true, services: dental2,
    staff: [staff('Ziad', all(dental2), 4), staff('Hiba', all(dental2).slice(0, 3), 5)],
    hours: CLINIC_HOURS, clients: 20, pastAppointments: 32,
  },
  {
    slug: 'levant-family-dentistry', name: 'Levant Family Dentistry', category: 'dental-clinics', area: 'tripoli',
    address: 'Azmi Street, Tripoli', locale: 'en', logo: true, services: dental3,
    staff: [staff('Nabil', all(dental3), 6)],
    hours: CLINIC_HOURS, clients: 16, pastAppointments: 26,
  },
  // Beauty clinics
  {
    slug: 'pearl-skin-clinic', name: 'Pearl Skin Clinic', category: 'beauty-clinics', area: 'beirut',
    address: 'Sassine Square, Achrafieh', locale: 'en', logo: true, services: beauty1,
    staff: [staff('Tamara', all(beauty1), 7), staff('Reem', all(beauty1).slice(1), 0)],
    hours: CLINIC_HOURS, clients: 21, pastAppointments: 34,
  },
  {
    slug: 'blue-wave-aesthetic-center', name: 'Blue Wave Aesthetic Center', category: 'beauty-clinics', area: 'sidon',
    address: 'Saida Boulevard, Sidon', locale: 'ar', logo: false, services: beauty2,
    staff: [staff('Rouba', all(beauty2), 1)],
    hours: CLINIC_HOURS, clients: 13, pastAppointments: 22,
  },
  {
    slug: 'jasmine-beauty-clinic', name: 'Jasmine Beauty Clinic', category: 'beauty-clinics', area: 'zahle',
    address: 'Berdawni Road, Zahle', locale: 'en', logo: true, services: beauty3,
    staff: [staff('Lara', all(beauty3), 2)],
    hours: CLINIC_HOURS, clients: 11, pastAppointments: 21,
  },
  // Spa and massage
  {
    slug: 'serenity-cedar-spa', name: 'Serenity Cedar Spa', category: 'spa-massage', area: 'jounieh',
    address: 'Maameltein Road, Jounieh', locale: 'en', logo: true, services: spa1,
    staff: [staff('Zeina', all(spa1), 3), staff('Mira', all(spa1).slice(0, 5), 4)],
    hours: SPA_HOURS, clients: 23, pastAppointments: 38,
  },
  {
    slug: 'blue-harbour-massage-studio', name: 'Blue Harbour Massage Studio', category: 'spa-massage', area: 'tyre',
    address: 'Tyre Corniche, Tyre', locale: 'en', logo: true, services: spa2,
    staff: [staff('Samar', all(spa2), 5)],
    hours: SPA_HOURS, clients: 12, pastAppointments: 23,
  },
  {
    slug: 'olive-grove-wellness-spa', name: 'Olive Grove Wellness Spa', category: 'spa-massage', area: 'beirut',
    address: 'Jal el Dib Highway, Metn', locale: 'en', logo: true, services: spa3,
    staff: [staff('Farah', all(spa3), 6), staff('Salma', all(spa3).slice(1), 7)],
    hours: SPA_HOURS, clients: 20, pastAppointments: 35,
  },
  // Physiotherapy
  {
    slug: 'levant-physio-rehab', name: 'Levant Physio and Rehab', category: 'physiotherapy', area: 'beirut',
    address: 'Sodeco Street, Achrafieh', locale: 'en', logo: true, services: physio1,
    staff: [staff('Tarek', all(physio1), 0), staff('Rita', all(physio1).slice(0, 4), 1)],
    hours: CLINIC_HOURS, clients: 19, pastAppointments: 33,
  },
  {
    slug: 'cedar-motion-physiotherapy', name: 'Cedar Motion Physiotherapy', category: 'physiotherapy', area: 'sidon',
    address: 'Sidon Corniche, Sidon', locale: 'ar', logo: false, services: physio2,
    staff: [staff('Sami', all(physio2), 2)],
    hours: CLINIC_HOURS, clients: 10, pastAppointments: 24,
  },
  {
    slug: 'phoenician-recovery-center', name: 'Phoenician Recovery Center', category: 'physiotherapy', area: 'tripoli',
    address: 'Al Mina Road, Tripoli', locale: 'en', logo: true, services: physio3,
    staff: [staff('Elias', all(physio3), 3)],
    hours: CLINIC_HOURS, clients: 9, pastAppointments: 20,
  },
];

/** The plan a business is created with: more than one bookable person means PRO (demo data sets it directly). */
export const planOf = (b: BusinessSpec): 'FREE' | 'PRO' => (b.staff.length > 1 ? 'PRO' : 'FREE');

/** Placeholder login addresses end here: the reserved `.invalid` TLD never resolves, so no mail can reach anyone. */
export const PLACEHOLDER_DOMAIN = 'demo.invalid';
export const placeholderOwnerEmail = (slug: string) => `owner+${slug}@${PLACEHOLDER_DOMAIN}`;
export const placeholderReceptionEmail = (slug: string) => `rana+${slug}@${PLACEHOLDER_DOMAIN}`;

export const FLAGSHIP_DEPOSIT = { threshold: 2, amount: 10 } as const;
