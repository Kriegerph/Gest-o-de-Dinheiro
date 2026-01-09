import { Injectable } from '@angular/core';
import {
  Auth,
  User,
  authState,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from '@angular/fire/auth';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail
} from 'firebase/auth';
import {
  Firestore,
  doc,
  docData,
  serverTimestamp,
  setDoc,
  updateDoc
} from '@angular/fire/firestore';
import { from, map, Observable, of, shareReplay, switchMap } from 'rxjs';
import { UserProfile } from '../models/user-profile.model';
import { CategoriesService } from './categories.service';
import { localDateFromYmd } from '../../shared/utils/date.util';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  readonly user$: Observable<User | null>;
  readonly profile$: Observable<UserProfile | null>;

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private categoriesService: CategoriesService
  ) {
    this.user$ = authState(this.auth).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    this.profile$ = this.user$.pipe(
      switchMap((user) =>
        user
          ? (docData(doc(this.firestore, `users/${user.uid}`)) as Observable<UserProfile>)
          : of(null)
      ),
      map((profile) =>
        profile?.birthDate
          ? { ...profile, age: this.calculateAge(profile.birthDate) }
          : profile
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  async register(
    email: string,
    password: string,
    profileData: Pick<UserProfile, 'firstName' | 'lastName' | 'birthDate' | 'age'>
  ): Promise<User> {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    const profileRef = doc(this.firestore, `users/${cred.user.uid}`);
    await setDoc(profileRef, {
      uid: cred.user.uid,
      email,
      ...profileData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await this.categoriesService.ensureDefaultCategories(cred.user.uid);
    return cred.user;
  }

  login(email: string, password: string): Observable<User> {
    return from(signInWithEmailAndPassword(this.auth, email, password)).pipe(
      switchMap((cred) =>
        from(this.categoriesService.ensureDefaultCategories(cred.user.uid)).pipe(
          map(() => cred.user)
        )
      )
    );
  }

  logout(): Observable<void> {
    return from(signOut(this.auth));
  }

  async updateProfile(
    data: Pick<UserProfile, 'firstName' | 'lastName' | 'birthDate' | 'age'>
  ): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('Usuário não autenticado');
    }
    const ref = doc(this.firestore, `users/${user.uid}`);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp()
    });
  }

  async reauthenticate(currentPassword: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('USER_NOT_LOGGED');
    }
    const email = user.email;
    if (!email) {
      throw new Error('USER_NO_EMAIL');
    }
    const credential = EmailAuthProvider.credential(email, currentPassword);
    await reauthenticateWithCredential(user, credential);
  }

  async requestEmailChange(newEmail: string, currentPassword: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('USER_NOT_LOGGED');
    }
    if (!newEmail || !newEmail.includes('@')) {
      throw new Error('INVALID_EMAIL');
    }
    await this.reauthenticate(currentPassword);
    await verifyBeforeUpdateEmail(user, newEmail);
  }

  async updateUserPassword(newPassword: string, currentPassword: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('USER_NOT_LOGGED');
    }
    if (!newPassword || newPassword.length < 6) {
      throw new Error('WEAK_PASSWORD');
    }
    await this.reauthenticate(currentPassword);
    await updatePassword(user, newPassword);
  }

  async updateEmailSecure(currentPassword: string, newEmail: string): Promise<void> {
    await this.requestEmailChange(newEmail, currentPassword);
  }

  async updatePasswordSecure(currentPassword: string, newPassword: string): Promise<void> {
    await this.updateUserPassword(newPassword, currentPassword);
  }

  private calculateAge(birthDate: string): number {
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
