import readline from 'readline';
import { provisionOwner, hasAnyOwner } from '../modules/identity/provisioning';
import { closeDbPool } from '../lib/db';

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      // In interactive terminal, hide typed password
      process.stdout.write(question);
      const stdin = process.stdin;
      let input = '';

      const onData = (char: Buffer) => {
        const str = char.toString('utf-8');
        switch (str) {
          case '\n':
          case '\r':
          case '\u0004':
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            rl.close();
            resolve(input);
            break;
          case '\u0003':
            process.exit(1);
            break;
          default:
            input += str;
            break;
        }
      };

      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  console.log('====================================================');
  console.log(' LawOffice OS — تهيئة حساب المالك الأول (Setup Tool) ');
  console.log('====================================================\n');

  try {
    const alreadyExists = await hasAnyOwner();
    if (alreadyExists) {
      console.error('[خطأ أمني]: حساب المالك مهيأ بالفعل في قاعدة البيانات.');
      console.error('تم إغلاق مسار التهيئة تلقائياً لمنع إضافة حسابات مالك إضافية.');
      process.exit(1);
    }

    const name =
      process.env.OWNER_NAME || (await prompt('أدخل الاسم الكامل للمالك: '));
    const email =
      process.env.OWNER_EMAIL || (await prompt('أدخل البريد الإلكتروني للمالك: '));
    const password =
      process.env.OWNER_PASSWORD || (await prompt('أدخل كلمة المرور (8 أحرف على الأقل): ', true));

    if (!name || !email || !password) {
      console.error('[خطأ]: جميع الحقول (الاسم، البريد الإلكتروني، كلمة المرور) مطلوبة.');
      process.exit(1);
    }

    console.log('\nجارٍ إنشاء الحساب وتوليد مفاتيح المصادقة الثنائية ورموز الاسترداد...\n');

    const result = await provisionOwner({ name, email, password });

    console.log('====================================================');
    console.log('✓ تم إنشاء وتأمين حساب المالك بنجاح!');
    console.log('====================================================');
    console.log(`الاسم:             ${result.user.name}`);
    console.log(`البريد الإلكتروني: ${result.user.email}`);
    console.log(`الدور:             ${result.user.role}`);
    console.log('----------------------------------------------------');
    console.log('مفتاح تطبيق المصادقة الثنائية (TOTP Secret):');
    console.log(`  ${result.totpSecret}`);
    console.log('\nرابط إعداد المصادقة (TOTP URI):');
    console.log(`  ${result.totpURI}`);
    console.log('----------------------------------------------------');
    console.log('رموز الاسترداد للطوارئ (Single-Use Recovery Codes):');
    console.log('تنبيه: احتفظ بهذه الرموز مطبوعة في مكان آمن ومنفصل خارج الخادم:');
    result.backupCodes.forEach((code, idx) => {
      console.log(`  ${idx + 1}. ${code}`);
    });
    console.log('====================================================');
    console.log('تم إغلاق مسار الإعداد بنجاح.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'خطأ غير متوقع';
    console.error(`\n[فشل التهيئة]: ${message}`);
    process.exit(1);
  } finally {
    await closeDbPool().catch(() => {});
  }
}

if (require.main === module || process.argv[1]?.includes('provision-owner')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}