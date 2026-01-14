// TODO: Firebase Cloud Function (scheduler) for automatic credit payment reconciliation.
// Reference-only snippet, not wired into the Angular build.
//
// import * as functions from 'firebase-functions';
// import * as admin from 'firebase-admin';
//
// admin.initializeApp();
//
// export const reconcileCreditInstallments = functions.pubsub
//   .schedule('every day 03:00')
//   .timeZone('America/Sao_Paulo')
//   .onRun(async () => {
//     const db = admin.firestore();
//     const todayYmd = new Date().toISOString().slice(0, 10);
//     const usersSnap = await db.collection('users').get();
//
//     for (const userDoc of usersSnap.docs) {
//       const uid = userDoc.id;
//       const installmentsSnap = await db
//         .collection(`users/${uid}/creditInstallments`)
//         .where('paid', '==', false)
//         .where('dueDate', '<=', todayYmd)
//         .get();
//
//       for (const instDoc of installmentsSnap.docs) {
//         const inst = instDoc.data();
//         if (inst.linkedTransactionId) continue;
//
//         const purchaseDoc = await db.doc(`users/${uid}/creditPurchases/${inst.purchaseId}`).get();
//         const cardDoc = await db.doc(`users/${uid}/creditCards/${inst.cardId}`).get();
//         const purchase = purchaseDoc.data();
//         const card = cardDoc.data();
//
//         const txRef = await db.collection(`users/${uid}/transactions`).add({
//           type: 'expense',
//           description: `Cartao: ${card?.name} - ${purchase?.description} (${inst.installmentNumber}/${purchase?.installmentsCount})`,
//           amount: inst.amount,
//           date: inst.dueDate,
//           accountId: inst.paymentAccountId,
//           categoryId: purchase?.categoryId || null,
//           notes: 'Gerado automaticamente pelo Credito',
//           createdAt: admin.firestore.FieldValue.serverTimestamp()
//         });
//
//         await instDoc.ref.update({
//           paid: true,
//           paidAt: admin.firestore.FieldValue.serverTimestamp(),
//           linkedTransactionId: txRef.id
//         });
//       }
//     }
//   });
