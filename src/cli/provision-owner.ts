import readline from 'readline';
import { Writable } from 'stream';
import {
  provisionOwner,
  confirmOwnerProvisioning,
  isBootstrapClosed,
  ProvisionOwnerResult,
} from '../modules/identity/provisioning';
import { getPrismaClient } from '../lib/auth';
import { closeDbPool } from '../lib/db';

export class MutableStdout extends Writable {
  public muted = false;
  private target: NodeJS.WritableStream;

  constructor(target: NodeJS.WritableStream = process.stdout) {
    super();
    this.target = target;
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (!this.muted) {
      if (typeof chunk === 'string') {
        this.target.write(chunk, encoding);
      } else {
        this.target.write(chunk);
      }
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
    const bootstrapClosed = await isBootstrapClosed();
    if (bootstrapClosed) {
      console.error('[خطأ أمني]: حساب المالك مهيأ بالفعل أو تم إغلاق مسار التهيئة الأولية بشكل دائم.');
      console.error('تم إغلاق مسار التهيئة تلقائياً لمنع إضافة حسابات مالك إضافية.');
      process.exitCode = 1;
      return;
    }

    const prisma = getPrismaClient();
    const existingOwner = await prisma.user.findFirst({
      where: { role: 'OWNER' },
      include: {
        twoFactors: true,
      },
    });

    if (existingOwner && existingOwner.twoFactors[0]?.verified === true) {
      console.error('[خطأ أمني]: حساب المالك مهيأ ومكتمل بالفعل في النظام.');
      process.exitCode = 1;
      return;
    }

    const isInteractive = Boolean(process.stdin.isTTY);
    let result: ProvisionOwnerResult;

    if (existingOwner && existingOwner.twoFactors[0]?.verified === false) {
      // Pending owner setup detected - resume setup
      console.log('تنبيه: تم العثور على حساب مالك معلق لم يكتمل إعداده بعد.');
      console.log(`البريد الإلكتروني المسجل: ${existingOwner.email}\n`);

      const password =
        process.env.OWNER_PASSWORD ||
        (isInteractive
          ? await prompt('أدخل كلمة المرور لاستئناف إعداد حساب المالك المعلق: ', true)
          : '');

      if (!password) {
        console.error('[خطأ]: كلمة المرور مطلوبة لاستئناف إعداد الحساب المعلق.');
        process.exitCode = 1;
        return;
      }

      console.log('\nجارٍ استئناف إعداد الحساب واسترجاع مفاتيح المصادقة الثنائية...\n');
      result = await provisionOwner({
        name: existingOwner.name,
        email: existingOwner.email,
        password,
      });
    } else {
      // Fresh owner provisioning
      const name =
        process.env.OWNER_NAME || (isInteractive ? await prompt('أدخل الاسم الكامل للمالك: ') : '');
      const email =
        process.env.OWNER_EMAIL || (isInteractive ? await prompt('أدخل البريد الإلكتروني للمالك: ') : '');
      const password =
        process.env.OWNER_PASSWORD ||
        (isInteractive ? await prompt('أدخل كلمة المرور (8 أحرف على الأقل): ', true) : '');

      if (!name || !email || !password) {
        console.error('[خطأ]: جميع الحقول (الاسم، البريد الإلكتروني، كلمة المرور) مطلوبة.');
        process.exitCode = 1;
        return;
      }

      console.log('\nجارٍ إنشاء الحساب وتوليد مفاتيح المصادقة الثنائية...\n');
      result = await provisionOwner({ name, email, password });
    }

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
      process.exitCode = 1;
      return;
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
    process.exitCode = 1;
    return;
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