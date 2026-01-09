import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
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
export class SettingsComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private document = inject(DOCUMENT);
  private profileSub?: Subscription;

  profileMessage = '';
  emailMessage = '';
  passwordMessage = '';
  savingProfile = false;
  sendingEmail = false;
  updatingPassword = false;
  show = {
    emailCurrent: false,
    passwordCurrent: false,
    passwordNew: false,
    passwordConfirm: false
  };
  selectedTab: 'perfil' | 'conta' = 'perfil';

  profileForm = this.fb.group({
    firstName: new FormControl<string | null>(null, { nonNullable: false, validators: [Validators.required] }),
    lastName: new FormControl<string | null>(null, { nonNullable: false, validators: [Validators.required] }),
    birthDate: new FormControl<string | null>(null, { nonNullable: false, validators: [Validators.required] })
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
    {
      validators: (group: any) =>
        group.get('newPassword')?.value === group.get('confirmPassword')?.value ? null : { mismatch: true }
    }
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

  ngOnInit(): void {
    this.document.body.classList.add('no-page-scroll');
    this.document.documentElement.classList.add('no-page-scroll');
  }

  ngOnDestroy(): void {
    this.profileSub?.unsubscribe();
    this.document.body.classList.remove('no-page-scroll');
    this.document.documentElement.classList.remove('no-page-scroll');
  }

  setTab(tab: 'perfil' | 'conta') {
    this.selectedTab = tab;
  }

  isTabActive(tab: 'perfil' | 'conta') {
    return this.selectedTab === tab;
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
    this.savingProfile = true;
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
    } finally {
      this.savingProfile = false;
    }
  }

  async changeEmail() {
    this.emailMessage = '';
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }
    const { currentPassword, newEmail } = this.emailForm.value;
    this.sendingEmail = true;
    try {
      await this.auth.requestEmailChange(newEmail!, currentPassword!);
      this.emailMessage =
        'Enviamos um link de confirmação para o novo e-mail. Abra o e-mail e clique no link para concluir a alteração.';
      this.emailForm.reset();
    } catch (err: any) {
      const code = err?.code ?? err?.message;
      switch (code) {
        case 'auth/wrong-password':
          this.emailMessage = 'Senha atual incorreta.';
          break;
        case 'auth/requires-recent-login':
          this.emailMessage = 'Por segurança, faça login novamente e tente de novo.';
          break;
        case 'auth/email-already-in-use':
          this.emailMessage = 'Esse e-mail já está em uso.';
          break;
        case 'auth/invalid-email':
        case 'INVALID_EMAIL':
          this.emailMessage = 'E-mail inválido.';
          break;
        case 'OPERATION_NOT_ALLOWED':
          this.emailMessage = 'Seu projeto exige verificação do novo e-mail. Tente novamente.';
          break;
        default:
          this.emailMessage = 'Não foi possível solicitar a troca de e-mail.';
      }
    } finally {
      this.sendingEmail = false;
    }
  }

  async changePassword() {
    this.passwordMessage = '';
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.passwordForm.value;
    this.updatingPassword = true;
    try {
      await this.auth.updateUserPassword(newPassword!, currentPassword!);
      this.passwordMessage = 'Senha atualizada.';
      this.passwordForm.reset();
    } catch (err: any) {
      this.passwordMessage = err?.message ?? 'Erro ao atualizar senha.';
    } finally {
      this.updatingPassword = false;
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
