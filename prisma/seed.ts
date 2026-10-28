import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Demo data: "Studio Nour" (Hamra, Beirut) and a second business "Clinic Rida" for isolation tests.
 * Idempotent: every row is found or upserted by a natural key, so re-running never duplicates.
 * Refuses to run in production.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV=production.');
  process.exit(1);
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DIRECT_URL or DATABASE_URL must be set.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Seeded users get a password only if argon2 is installed (auth lands in P1.7). Otherwise they are password-less. */
async function makeHasher(): Promise<((plain: string) => Promise<string>) | undefined> {
  try {
    const moduleName = 'argon2';
    const argon2 = (await import(moduleName)) as { hash: (plain: string) => Promise<string> };
    return argon2.hash;
  } catch {
    return undefined;
  }
}

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

async function seedBusiness(spec: SeedBusiness, hash?: (plain: string) => Promise<string>) {
  const password = process.env.SEED_USER_PASSWORD ?? 'maw3ed-dev-password';

  const business = await prisma.business.upsert({
    where: { slug: spec.slug },
    update: {
      name: spec.name,
      category: spec.category,
      address: spec.address,
      timezone: 'Asia/Beirut',
    },
    create: {
      slug: spec.slug,
      name: spec.name,
      category: spec.category,
      address: spec.address,
      timezone: 'Asia/Beirut',
    },
  });

  const userIds = new Map<string, string>();
  for (const u of spec.users) {
    const email = u.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    // Never overwrite an existing password hash on re-run.
    const passwordHash = existing?.passwordHash ?? (hash ? await hash(password) : null);
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
  const hash = await makeHasher();
  if (!hash)
    console.log('argon2 is not installed: seeded users are password-less until auth lands (P1.7).');
  for (const spec of [studioNour, clinicRida]) {
    const b = await seedBusiness(spec, hash);
    console.log(`seeded ${b.name} (${b.slug})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
