import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { localDateFromYmd } from '../../shared/utils/date.util';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnDestroy {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private profileSub?: Subscription;

  profileMessage = '';
  emailMessage = '';
  passwordMessage = '';
  show = {
    emailCurrent: false,
    passwordCurrent: false,
    passwordNew: false,
    passwordConfirm: false
  };

  profileForm = this.fb.group({
    firstName: new FormControl<string | null>(null, { nonNullable: false, validators: [Validators.required] }),
    lastName: new FormControl<string | null>(null, { nonNullable: false, validators: [Validators.required] }),
    birthDate: new FormControl<string | null>(null, { nonNullable: false, validators: [Validators.required] }),
  });

  emailForm = this.fb.group({
    newEmail: ['', [Validators.required, Validators.email]],
    currentPassword: ['', Validators.required]
  });

  passwordForm = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required]
    },
    { validators: (group: any) => (group.get('newPassword')?.value === group.get('confirmPassword')?.value ? null : { mismatch: true }) }
  );

  constructor() {
    this.profileSub = this.auth.profile$.subscribe((profile) => {
      if (profile) {
        this.profileForm.patchValue({
          firstName: profile.firstName,
          lastName: profile.lastName,
          birthDate: profile.birthDate ?? null
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.profileSub?.unsubscribe();
  }

  async saveProfile() {
    this.profileMessage = '';
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    const birthDate = this.profileForm.value.birthDate;
    const age = this.calculateAge(birthDate);
    if (age < 18) {
      this.profileForm.get('birthDate')?.setErrors({ underage: true });
      return;
    }
    try {
      const { firstName, lastName } = this.profileForm.value;
      await this.auth.updateProfile({
        firstName: firstName!,
        lastName: lastName!,
        birthDate: birthDate!,
        age
      });
      this.profileMessage = 'Perfil atualizado.';
    } catch (err: any) {
      this.profileMessage = err?.message ?? 'Erro ao atualizar perfil.';
    }
  }

  async changeEmail() {
    this.emailMessage = '';
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }
    const { currentPassword, newEmail } = this.emailForm.value;
    try {
      await this.auth.requestEmailChange(newEmail!, currentPassword!);
      this.emailMessage =
        'Enviamos um link de confirmacao para o novo e-mail. Abra o e-mail e clique no link para concluir a alteracao.';
      this.emailForm.reset();
    } catch (err: any) {
      const code = err?.code ?? err?.message;
      switch (code) {
        case 'auth/wrong-password':
          this.emailMessage = 'Senha atual incorreta.';
          break;
        case 'auth/requires-recent-login':
          this.emailMessage = 'Por seguranca, faca login novamente e tente de novo.';
          break;
        case 'auth/email-already-in-use':
          this.emailMessage = 'Esse e-mail ja esta em uso.';
          break;
        case 'auth/invalid-email':
        case 'INVALID_EMAIL':
          this.emailMessage = 'E-mail invalido.';
          break;
        case 'OPERATION_NOT_ALLOWED':
          this.emailMessage =
            'Seu projeto exige verificacao do novo e-mail. Tente novamente.';
          break;
        default:
          this.emailMessage = 'Nao foi possivel solicitar a troca de e-mail.';
      }
    }
  }

  async changePassword() {
    this.passwordMessage = '';
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.passwordForm.value;
    try {
      await this.auth.updateUserPassword(newPassword!, currentPassword!);
      this.passwordMessage = 'Senha atualizada.';
      this.passwordForm.reset();
    } catch (err: any) {
      this.passwordMessage = err?.message ?? 'Erro ao atualizar senha.';
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
