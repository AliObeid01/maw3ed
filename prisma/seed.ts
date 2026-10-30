import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Demo data: "Studio Nour" (Hamra, Beirut) and a second business "Clinic Rida" for isolation tests.
 * Idempotent: every row is found or upserted by a natural key, so re-running never duplicates.
 *
 * Safety (NODE_ENV alone is not a guard, so seeding is opt-in):
 *   - ALLOW_SEED=1 is required.
 *   - The database host must be localhost/127.0.0.1 unless ALLOW_SEED_REMOTE=1 is also set.
 *     The shared dev Neon branch therefore needs both:  ALLOW_SEED=1 ALLOW_SEED_REMOTE=1 pnpm db:seed
 *   - Refuses outright when NODE_ENV=production, whatever the flags.
 *
 * Passwords: set SEED_USER_PASSWORD, or one is generated and printed once. Hashed with argon2id (the same
 * library and defaults as the app), so seeded users can sign in. Existing hashes are never overwritten.
 */
function fail(message: string): never {
  console.error(`Refusing to seed: ${message}`);
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') fail('NODE_ENV=production.');
if (process.env.ALLOW_SEED !== '1') fail('set ALLOW_SEED=1 to opt in.');

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) fail('DIRECT_URL or DATABASE_URL must be set.');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const hosts = [process.env.DIRECT_URL, process.env.DATABASE_URL]
  .filter((u): u is string => Boolean(u))
  .map((u) => new URL(u).hostname);
if (!hosts.every((h) => LOCAL_HOSTS.has(h)) && process.env.ALLOW_SEED_REMOTE !== '1') {
  fail(
    `database host is not local (${hosts.join(', ')}); also set ALLOW_SEED_REMOTE=1 if that is intended.`,
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type SeedUser = { email: string; name: string; role: 'OWNER' | 'STAFF' };
type SeedStaff = {
  displayName: string;
  bookable: boolean;
  colour: string;
  userEmail?: string;
  serviceNames: string[];
};
type SeedService = { name: string; durationMin: number; bufferMin: number; price: string };
type SeedBusiness = {
  slug: string;
  name: string;
  category: string;
  address: string;
  plan: 'FREE' | 'PRO';
  users: SeedUser[];
  services: SeedService[];
  staff: SeedStaff[];
  /** Weekdays 0 (Sun) to 6 (Sat) and the local intervals worked on each. */
  hours: { weekdays: number[]; intervals: [string, string][] };
};

const studioNour: SeedBusiness = {
  slug: 'studio-nour',
  name: 'Studio Nour',
  category: 'salon',
  address: 'Hamra Street, Beirut',
  plan: 'PRO',
  users: [
    { email: 'lina@studionour.test', name: 'Lina', role: 'OWNER' },
    { email: 'karim@studionour.test', name: 'Karim', role: 'STAFF' },
    { email: 'jad@studionour.test', name: 'Jad', role: 'STAFF' },
    { email: 'rana@studionour.test', name: 'Rana', role: 'STAFF' },
  ],
  services: [
    { name: 'Haircut', durationMin: 30, bufferMin: 0, price: '15.00' },
    { name: 'Blow-dry', durationMin: 45, bufferMin: 0, price: '20.00' },
    { name: 'Hair colour', durationMin: 90, bufferMin: 0, price: '45.00' },
    { name: 'Beard trim', durationMin: 20, bufferMin: 0, price: '8.00' },
    { name: 'Manicure', durationMin: 40, bufferMin: 0, price: '18.00' },
  ],
  staff: [
    {
      displayName: 'Lina',
      bookable: true,
      colour: '#0E7C66',
      userEmail: 'lina@studionour.test',
      serviceNames: ['Haircut', 'Blow-dry', 'Hair colour', 'Manicure'],
    },
    {
      displayName: 'Karim',
      bookable: true,
      colour: '#C2410C',
      userEmail: 'karim@studionour.test',
      serviceNames: ['Haircut', 'Blow-dry', 'Hair colour', 'Beard trim'],
    },
    {
      displayName: 'Jad',
      bookable: true,
      colour: '#1D4ED8',
      userEmail: 'jad@studionour.test',
      serviceNames: ['Haircut', 'Beard trim'],
    },
    // Receptionist: has a login, takes no appointments.
    {
      displayName: 'Rana',
      bookable: false,
      colour: '#7C3AED',
      userEmail: 'rana@studionour.test',
      serviceNames: [],
    },
  ],
  // Mon to Sat, 09:00-19:00 with a 13:00-14:00 break, stored as two intervals.
  hours: {
    weekdays: [1, 2, 3, 4, 5, 6],
    intervals: [
      ['09:00', '13:00'],
      ['14:00', '19:00'],
    ],
  },
};

const clinicRida: SeedBusiness = {
  slug: 'clinic-rida',
  name: 'Clinic Rida',
  category: 'clinic',
  address: 'Verdun, Beirut',
  plan: 'FREE',
  users: [{ email: 'rida@clinicrida.test', name: 'Dr. Rida', role: 'OWNER' }],
  services: [
    { name: 'Consultation', durationMin: 30, bufferMin: 10, price: '30.00' },
    { name: 'Follow-up', durationMin: 20, bufferMin: 10, price: '20.00' },
  ],
  staff: [
    {
      displayName: 'Dr. Rida',
      bookable: true,
      colour: '#0F766E',
      userEmail: 'rida@clinicrida.test',
      serviceNames: ['Consultation', 'Follow-up'],
    },
  ],
  hours: { weekdays: [1, 2, 3, 4, 5], intervals: [['09:00', '17:00']] },
};

async function seedBusiness(
  spec: SeedBusiness,
  hash: (plain: string) => Promise<string>,
  password: string,
) {
  const business = await prisma.business.upsert({
    where: { slug: spec.slug },
    update: {
      name: spec.name,
      category: spec.category,
      address: spec.address,
      plan: spec.plan,
      timezone: 'Asia/Beirut',
    },
    create: {
      slug: spec.slug,
      name: spec.name,
      category: spec.category,
      address: spec.address,
      plan: spec.plan,
      timezone: 'Asia/Beirut',
    },
  });

  const userIds = new Map<string, string>();
  for (const u of spec.users) {
    const email = u.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    // Never overwrite an existing password hash on re-run.
    const passwordHash = existing?.passwordHash ?? (await hash(password));
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: u.name, passwordHash },
      create: { email, name: u.name, passwordHash },
    });
    userIds.set(email, user.id);
    await prisma.membership.upsert({
      where: { userId_businessId: { userId: user.id, businessId: business.id } },
      update: { role: u.role },
      create: { userId: user.id, businessId: business.id, role: u.role },
    });
  }

  const serviceIds = new Map<string, string>();
  for (const [index, s] of spec.services.entries()) {
    const existing = await prisma.service.findFirst({
      where: { businessId: business.id, name: s.name },
    });
    const data = {
      durationMin: s.durationMin,
      bufferMin: s.bufferMin,
      price: s.price,
      active: true,
      sortOrder: index,
    };
    const service = existing
      ? await prisma.service.update({ where: { id: existing.id }, data })
      : await prisma.service.create({ data: { businessId: business.id, name: s.name, ...data } });
    serviceIds.set(s.name, service.id);
  }

  for (const st of spec.staff) {
    const userId = st.userEmail ? userIds.get(st.userEmail.toLowerCase()) : undefined;
    const existing = await prisma.staffMember.findFirst({
      where: { businessId: business.id, displayName: st.displayName },
    });
    const data = { userId: userId ?? null, bookable: st.bookable, colour: st.colour, active: true };
    const staff = existing
      ? await prisma.staffMember.update({ where: { id: existing.id }, data })
      : await prisma.staffMember.create({
          data: { businessId: business.id, displayName: st.displayName, ...data },
        });

    // Replace the join rows and weekly hours so the result matches the spec exactly on every run.
    await prisma.staffService.deleteMany({ where: { businessId: business.id, staffId: staff.id } });
    await prisma.staffService.createMany({
      data: st.serviceNames.map((name) => ({
        businessId: business.id,
        staffId: staff.id,
        serviceId: serviceIds.get(name) as string,
      })),
    });

    await prisma.workingHours.deleteMany({ where: { businessId: business.id, staffId: staff.id } });
    if (st.bookable) {
      await prisma.workingHours.createMany({
        data: spec.hours.weekdays.flatMap((weekday) =>
          spec.hours.intervals.map(([startLocal, endLocal]) => ({
            businessId: business.id,
            staffId: staff.id,
            weekday,
            startLocal,
            endLocal,
          })),
        ),
      });
    }
  }

  return business;
}

async function main() {
  const hash = argon2Hash;
  const generated = !process.env.SEED_USER_PASSWORD;
  const password = process.env.SEED_USER_PASSWORD ?? randomBytes(12).toString('base64url');
  if (generated) console.log(`Generated seed password (shown once): ${password}`);
  for (const spec of [studioNour, clinicRida]) {
    const b = await seedBusiness(spec, hash, password);
    console.log(`seeded ${b.name} (${b.slug})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
