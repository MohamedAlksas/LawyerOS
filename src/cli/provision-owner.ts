import readline from 'readline';
import { Writable } from 'stream';
import { provisionOwner, confirmOwnerProvisioning, hasAnyOwner } from '../modules/identity/provisioning';
import { closeDbPool } from '../lib/db';

class MutableStdout extends Writable {
  public muted = false;

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (!this.muted) {
      process.stdout.write(chunk, encoding);
    }
    callback();
  }
}

async function prompt(question: string, hidden = false): Promise<string> {
  const isInteractive = Boolean(process.stdin.isTTY);

  if (hidden && isInteractive) {
    const mutableStdout = new MutableStdout();

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });

    return new Promise((resolve) => {
      process.stdout.write(question);
      mutableStdout.muted = true;
      rl.question('', (answer) => {
        mutableStdout.muted = false;
        process.stdout.write('\n');
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('====================================================');
  console.log(' LawOffice OS — تهيئة حساب المالك الأول (Setup Tool) ');
  console.log('====================================================\n');

  try {
    const alreadyExists = await hasAnyOwner();
    if (alreadyExists) {
      console.error('[خطأ أمني]: حساب المالك مهيأ بالفعل أو تم إغلاق مسار التهيئة الأولية بشكل دائم.');
      console.error('تم إغلاق مسار التهيئة تلقائياً لمنع إضافة حسابات مالك إضافية.');
      process.exit(1);
    }

    const isInteractive = Boolean(process.stdin.isTTY);

    const name =
      process.env.OWNER_NAME || (isInteractive ? await prompt('أدخل الاسم الكامل للمالك: ') : '');
    const email =
      process.env.OWNER_EMAIL || (isInteractive ? await prompt('أدخل البريد الإلكتروني للمالك: ') : '');
    const password =
      process.env.OWNER_PASSWORD ||
      (isInteractive ? await prompt('أدخل كلمة المرور (8 أحرف على الأقل): ', true) : '');

    if (!name || !email || !password) {
      console.error('[خطأ]: جميع الحقول (الاسم، البريد الإلكتروني، كلمة المرور) مطلوبة.');
      process.exit(1);
    }

    console.log('\nجارٍ إنشاء الحساب وتوليد مفاتيح المصادقة الثنائية...\n');

    const result = await provisionOwner({ name, email, password, verified: false });

    if (isInteractive) {
      console.log('----------------------------------------------------');
      console.log('مفتاح تطبيق المصادقة الثنائية (TOTP Secret):');
      console.log(`  ${result.totpSecret}`);
      console.log('\nرابط إعداد المصادقة (TOTP URI):');
      console.log(`  ${result.totpURI}`);
      console.log('----------------------------------------------------');
    }

    const totpCode =
      process.env.OWNER_TOTP_CODE ||
      (isInteractive
        ? await prompt('أدخل رمز التحقق المكون من 6 أرقام من تطبيق المصادقة لتأكيد الحيازة: ')
        : '');

    if (!totpCode) {
      console.error('[خطأ أمني]: رمز التحقق (TOTP Code) مطلوب لتأكيد حيازة المفتاح وإتمام التهيئة.');
      process.exit(1);
    }

    await confirmOwnerProvisioning(result.user.id, totpCode);

    console.log('====================================================');
    console.log('✓ تم تأكيد حيازة المفتاح وإغلاق مسار التهيئة الأولية بنجاح!');
    console.log('====================================================');
    console.log(`الاسم:             ${result.user.name}`);
    console.log(`البريد الإلكتروني: ${result.user.email}`);
    console.log(`الدور:             ${result.user.role}`);

    if (isInteractive) {
      console.log('----------------------------------------------------');
      console.log('رموز الاسترداد للطوارئ (Single-Use Recovery Codes):');
      console.log('تنبيه: احتفظ بهذه الرموز مطبوعة في مكان آمن ومنفصل خارج الخادم:');
      result.backupCodes.forEach((code, idx) => {
        console.log(`  ${idx + 1}. ${code}`);
      });
      console.log('====================================================');
    }

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