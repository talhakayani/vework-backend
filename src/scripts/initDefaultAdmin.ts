import User from '../models/User';

/**
 * Initialize default admin user if it doesn't exist
 * Default credentials:
 * Email: admin@vework.com
 * Password: admin123
 */
export const initDefaultAdmin = async (): Promise<void> => {
  try {
    const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@vework.com';
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

    const existingAdmin = await User.findOne({ email: defaultEmail });
    if (existingAdmin) {
      console.log('Default admin user already exists');
      return;
    }

    const admin = await User.create({
      email: defaultEmail,
      password: defaultPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      approvalStatus: 'approved',
    });

    console.log('✅ Default admin user created successfully!');
    console.log(`   Email: ${admin.email}`);
    console.log(`   Password: ${defaultPassword}`);
    console.log('   ⚠️  Please change the default password after first login!');
  } catch (error: any) {
    console.error('❌ Error creating default admin:', error.message);
  }
};
