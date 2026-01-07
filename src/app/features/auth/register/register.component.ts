import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { localDateFromYmd } from '../../../shared/utils/date.util';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  message = '';
  loading = false;
  showPassword = false;
  showConfirmPassword = false;

  form = this.fb.group(
    {
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      birthDate: [null, Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    },
    {
      validators: (group: any) =>
        group.get('password')?.value === group.get('confirmPassword')?.value ? null : { mismatch: true }
    }
  );

  async onSubmit() {
    this.message = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const birthDate = this.form.value.birthDate;
    const age = this.calculateAge(birthDate);
    if (age < 18) {
      this.form.get('birthDate')?.setErrors({ underage: true });
      return;
    }

    this.loading = true;
    try {
      const { email, password, firstName, lastName } = this.form.value;
      await this.auth.register(email!, password!, {
        firstName: firstName!,
        lastName: lastName!,
        birthDate: birthDate!,
        age
      });
      await this.router.navigate(['/app/dashboard']);
    } catch (err: any) {
      this.message = err?.message ?? 'Erro ao criar conta';
    } finally {
      this.loading = false;
    }
  }

  private calculateAge(birthDate: string | null | undefined): number {
    if (!birthDate) {
      return 0;
    }
    const birth = localDateFromYmd(birthDate);
    if (!birth) {
      return 0;
    }
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    return age;
  }
}
