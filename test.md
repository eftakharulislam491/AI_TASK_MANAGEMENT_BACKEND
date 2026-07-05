# Postman API Testing Guide (`test.md`)

এই ফাইলটিতে আমাদের নতুন **Backend Project** এর সমস্ত API রুট কিভাবে Postman দিয়ে টেস্ট করবেন তা বিস্তারিতভাবে তুলে ধরা হয়েছে। প্রতিটি রুটের কাজ **২ লাইনে সহজ বাংলায় ব্যাখ্যা** করা হয়েছে এবং সাথে প্রয়োজনীয় **Dummy Data** ও **Expected Response** দেওয়া হয়েছে।

---

## ⚙️ Postman Environment Setup (প্রস্তুতি)

সবগুলো রুট সহজে টেস্ট করার জন্য Postman-এ একটি নতুন Environment তৈরি করে নিচের ভ্যারিয়েবলগুলো সেট করে নিন:

| Variable Name | Default Value / Description |
| :--- | :--- |
| `base_url` | `http://localhost:5000/api/v1` |
| `accessToken` | *লগইন বা রেজিস্ট্রেশনের পর অটোমেটিক সেট হবে* |
| `organizationId` | *আপনার অর্গানাইজেশনের CUID (যেমন: `cm3z12345678901234567890a`)* |

### 🔑 Token Automatic Save Script (টিপস)
লগইন বা রেজিস্ট্রেশন করার সাথে সাথে যাতে এক্সেস টোকেনটি অটোমেটিক `accessToken` ভ্যারিয়েবলে সেভ হয়ে যায়, তার জন্য `/auth/login` এবং `/auth/register` রিকোয়েস্টের **Tests** ট্যাবে নিচের স্ক্রিপ্টটি পেস্ট করে রাখুন:

```javascript
const responseJson = pm.response.json();
if (responseJson.success && responseJson.data && responseJson.data.accessToken) {
    pm.environment.set("accessToken", responseJson.data.accessToken);
    console.log("Access Token updated successfully!");
}
if (responseJson.success && responseJson.data && responseJson.data.user && responseJson.data.user.currentOrganizationId) {
    pm.environment.set("organizationId", responseJson.data.user.currentOrganizationId);
    console.log("Organization ID updated successfully!");
}
```

---

## 📂 Modules & Routes Details

---

### 1️⃣ Authentication Module (`/auth`)

#### 📌 1. User & Organization Registration
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/auth/register`
* **ব্যাখ্যা (Explanation):**
  এটি সিস্টেমে একটি নতুন ইউজার এবং একইসাথে তার অর্গানাইজেশন ক্রিয়েট করার জন্য ব্যবহার করা হয়।
  এটি সফলভাবে রেজিস্ট্রেশন সম্পন্ন করে রেসপন্সে টোকেন পাঠায় এবং কুকিতে রিফ্রেশ ও এক্সেস টোকেন সেট করে।
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "type": "ORGANIZATION",
    "email": "owner@example.com",
    "password": "Password123!",
    "firstName": "John",
    "lastName": "Doe",
    "displayName": "John Doe",
    "organizationName": "Acme Corporation",
    "organizationSlug": "acme-corp"
  }
  ```
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "user": {
        "id": "cm3z11111111111111111111a",
        "email": "owner@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "displayName": "John Doe",
        "type": "ORGANIZATION",
        "role": "SUPER_ADMIN",
        "currentOrganizationId": "cm3z22222222222222222222b"
      },
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "eyJhbGciOi..."
    },
    "timestamp": "2026-07-05T16:50:00.000Z"
  }
  ```

#### 📌 2. User Login
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/auth/login`
* **ব্যাখ্যা (Explanation):**
  ইউজারদের নিবন্ধিত ইমেইল ও পাসওয়ার্ড ব্যবহার করে সিস্টেমে লগইন করার জন্য এটি ব্যবহৃত হয়।
  লগইন সফল হলে নতুন এক্সেস টোকেন জেনারেট হয় যা পরবর্তী সিকিউর রুটগুলো অ্যাক্সেস করতে সাহায্য করে।
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "type": "ORGANIZATION",
    "email": "owner@example.com",
    "password": "Password123!"
  }
  ```
* **Expected Response (200 OK):**
  *(রেজিস্ট্রেশনের মতো একই স্ট্রাকচারে টোকেন এবং ইউজার অবজেক্ট রিটার্ন করবে)*

#### 📌 3. Token Refresh
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/auth/refresh`
* **ব্যাখ্যা (Explanation):**
  পূর্বের এক্সেস টোকেনের মেয়াদ শেষ হয়ে গেলে নতুন ভ্যালিড এক্সেস টোকেন পাওয়ার জন্য এটি ব্যবহার করা হয়।
  এটি সিকিউরিটি বজায় রেখে ইউজারকে বারবার আইডি-পাসওয়ার্ড দিয়ে লগইন করা থেকে বিরত রাখে।
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "refreshToken": "eyJhbGciOi..."
  }
  ```
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "accessToken": "eyJhbGciOiNEW...",
      "refreshToken": "eyJhbGciOiNEW..."
    },
    "timestamp": "2026-07-05T16:51:00.000Z"
  }
  ```

#### 📌 4. Logout
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/auth/logout`
* **Headers:** `x-refresh-token: {{refreshToken}}` (অথবা Request Body-তে পাঠানো যাবে)
* **ব্যাখ্যা (Explanation):**
  ইউজারের সেশনটি শেষ করতে এবং সিস্টেম থেকে নিরাপদে লগআউট করতে এটি ব্যবহার করা হয়।
  এটি রিফ্রেশ টোকেনটিকে ডাটাবেজে ইনভ্যালিড করে দেয় এবং কুকিজগুলো ব্রাউজার বা ক্লায়েন্ট থেকে মুছে ফেলে।
* **Request Body (Optional - JSON):**
  ```json
  {
    "refreshToken": "eyJhbGciOi..."
  }
  ```
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Logged out successfully"
    },
    "timestamp": "2026-07-05T16:52:00.000Z"
  }
  ```

#### 📌 5. Get Logged-in User Profile
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/auth/me`
* **Headers:** `Authorization: Bearer {{accessToken}}`
* **ব্যাখ্যা (Explanation):**
  বর্তমানে লগইন থাকা ইউজারের সেশন প্রোফাইলের বেসিক ডাটা এবং রোল জানার জন্য এটি ব্যবহার করা হয়।
  এটি একটি প্রোটেক্টেড রুট যা শুধুমাত্র ভ্যালিড বিয়ারার টোকেন থাকলেই অ্যাক্সেস করা সম্ভব।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "id": "cm3z11111111111111111111a",
      "email": "owner@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "SUPER_ADMIN"
    },
    "timestamp": "2026-07-05T16:53:00.000Z"
  }
  ```

---

### 2️⃣ Users Module (`/users`)

> ⚠️ **গুরুত্বপূর্ণ:** এই মডিউলের সব রুট অ্যাক্সেস করতে `Authorization: Bearer {{accessToken}}` হেডার পাঠানো বাধ্যতামূলক।

#### 📌 1. Get Complete User Profile Details
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/users/me`
* **ব্যাখ্যা (Explanation):**
  লগইন থাকা ইউজারের প্রোফাইল ইনফরমেশন, অর্গানাইজেশন মেম্বারশিপ এবং মেটাডাটা সহ সম্পূর্ণ বিবরণী ভিউ করতে ব্যবহৃত হয়।
  ইউজার ড্যাশবোর্ডে ও সেটিংসে নিজের সব তথ্য লোড করার জন্য এই রুটটি দরকার পড়ে।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "id": "cm3z11111111111111111111a",
      "email": "owner@example.com",
      "profile": {
        "bio": "Developer and tech enthusiast",
        "phone": "+123456789",
        "currentJobTitle": "Lead Engineer"
      },
      "abilities": []
    },
    "timestamp": "2026-07-05T16:54:00.000Z"
  }
  ```

#### 📌 2. Update User Profile
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/users/me/profile`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "firstName": "John Updated",
    "lastName": "Doe Updated",
    "phone": "+9876543210",
    "bio": "Passionate backend engineer developing next-gen solutions.",
    "currentJobTitle": "Principal Backend Developer",
    "yearsOfExperience": 5,
    "websiteUrl": "https://johndoe.dev",
    "githubUrl": "https://github.com/johndoe"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  ইউজার তার নিজের প্রোফাইলের বিস্তারিত বিবরণী (যেমন- সোশ্যাল লিংক, ফোন নম্বর, বায়ো) আপডেট করার জন্য এটি ব্যবহার করেন।
  এতে যেকোনো ফিল্ড আংশিক (partial) আপডেট করা যায় কারণ এটি একটি PATCH রিকোয়েস্ট।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "id": "cm3z11111111111111111111a",
      "firstName": "John Updated",
      "lastName": "Doe Updated",
      "profile": {
        "phone": "+9876543210",
        "bio": "Passionate backend engineer developing next-gen solutions.",
        "currentJobTitle": "Principal Backend Developer",
        "yearsOfExperience": 5,
        "websiteUrl": "https://johndoe.dev",
        "githubUrl": "https://github.com/johndoe"
      }
    },
    "timestamp": "2026-07-05T16:55:00.000Z"
  }
  ```

#### 📌 3. Add Skill/Ability to Profile
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/users/me/abilities`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "name": "Node.js",
    "category": "Backend Development",
    "proficiencyLevel": "EXPERT",
    "proficiencyScore": 90,
    "yearsOfExperience": 4,
    "isPrimary": true,
    "notes": "Proficient in NestJS framework and Express.",
    "keywords": ["nest", "express", "javascript", "typescript"]
  }
  ```
* **ব্যাখ্যা (Explanation):**
  ইউজার তার প্রোফাইলে নিজের কাজের দক্ষতা বা স্কিল যোগ করার জন্য এটি ব্যবহার করেন।
  টাস্ক অ্যাসাইনমেন্টের সময় প্রজেক্ট ম্যানেজার যেন ইউজারের স্কিল অনুযায়ী কাজ সিলেক্ট করতে পারেন তা এটি নিশ্চিত করে।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_ability_123456",
      "userId": "cm3z11111111111111111111a",
      "name": "Node.js",
      "proficiencyLevel": "EXPERT",
      "proficiencyScore": 90,
      "isPrimary": true
    },
    "timestamp": "2026-07-05T16:56:00.000Z"
  }
  ```

#### 📌 4. Update Ability Details
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/users/me/abilities/{{abilityId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "proficiencyLevel": "EXPERT",
    "proficiencyScore": 95,
    "notes": "Updated details after completing senior backend role."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  পূর্বে প্রোফাইলে যোগ করা কোনো দক্ষতার বিবরণী (যেমন: এক্সপেরিয়েন্সের বছর বা স্কোর) এডিট ও আপডেট করার জন্য ব্যবহৃত হয়।
  স্কিল আইডি প্যারামিটার হিসেবে ইউআরএল-এ পাস করতে হয়।
* **Expected Response (200 OK):**
  *(আপডেটেড এবিলিটি অবজেক্ট রিটার্ন করে)*

#### 📌 5. Delete Ability
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/users/me/abilities/{{abilityId}}`
* **ব্যাখ্যা (Explanation):**
  প্রোফাইল থেকে কোনো অপ্রয়োজনীয় বা ভুল স্কিল মুছে ফেলার জন্য এই রুটটি ব্যবহার করা হয়。
  ডিলিট সম্পন্ন হলে এটি ডাটাবেজ থেকে ওই স্কিল রেকর্ডটি চিরতরে সরিয়ে দেয়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Ability deleted successfully"
    },
    "timestamp": "2026-07-05T16:57:00.000Z"
  }
  ```

#### 📌 6. List Organization Directory (Users List)
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/users/directory?page=1&limit=10&search=John`
* **Headers:** `x-organization-id: {{organizationId}}` (টিন্যান্ট ফিল্টারিংয়ের জন্য)
* **ব্যাখ্যা (Explanation):**
  একটি অর্গানাইজেশনের অন্তর্ভুক্ত সমস্ত মেম্বারদের লিস্ট সার্চ ও পেজিনেশন আকারে ভিউ করতে এটি ব্যবহার করা হয়।
  টিমে মেম্বার খোঁজার জন্য এবং টাস্ক এসাইন লিস্ট রেডি করার জন্য এটি অত্যন্ত কাজের।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "users": [
        {
          "id": "cm3z11111111111111111111a",
          "firstName": "John",
          "lastName": "Doe",
          "email": "owner@example.com",
          "role": "SUPER_ADMIN"
        }
      ],
      "meta": {
        "total": 1,
        "page": 1,
        "limit": 10,
        "totalPages": 1
      }
    },
    "timestamp": "2026-07-05T16:58:00.000Z"
  }
  ```

#### 📌 7. Get Details of a Directory User
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/users/directory/{{userId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনের অন্য যেকোনো সহকর্মীর প্রোফাইল ডিটেইলস এবং স্কিলসমূহ ভিউ করতে এটি ব্যবহার করা হয়।
  টিম মেম্বারদের কার্যদক্ষতা ও প্রোফাইল অন্য ইউজারদের দেখানোর জন্য এই রুটটি দরকারি।
* **Expected Response (200 OK):**
  *(ইউজারের প্রোফাইল এবং এবিলিটি লিস্টের অবজেক্ট রিটার্ন করে)*

#### 📌 8. Create Role Change Request
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/users/role-change-requests`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "targetUserId": "cm3z_member_12345",
    "requestedRole": "MANAGER",
    "organizationId": "cm3z_org_12345",
    "reason": "Promoted to lead and manage Project Alpha and team operations."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  কোনো মেম্বারের রোল পরিবর্তন (যেমন: MEMBER থেকে MANAGER) করার জন্য একটি অফিসিয়াল রিকোয়েস্ট তৈরি করতে এটি ব্যবহার করা হয়।
  সুরক্ষার জন্য রোল রিকোয়েস্টটি পেন্ডিং থাকে যতক্ষণ না কোনো এডমিন এটি রিভিউ করে।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_req_98765",
      "targetUserId": "cm3z_member_12345",
      "requestedRole": "MANAGER",
      "status": "PENDING",
      "reason": "Promoted to lead and manage Project Alpha and team operations."
    },
    "timestamp": "2026-07-05T16:59:00.000Z"
  }
  ```

#### 📌 9. List Role Change Requests
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/users/role-change-requests?page=1&limit=10&scope=pending`
* **ব্যাখ্যা (Explanation):**
  রোল পরিবর্তনের জন্য পাঠানো সমস্ত পেন্ডিং বা অনুরোধগুলোর তালিকা দেখতে এটি ব্যবহৃত হয়।
  এটি ম্যানেজার বা এডমিনদের পেন্ডিং রিকোয়েস্টগুলো পর্যালোচনা করতে সাহায্য করে।
* **Expected Response (200 OK):**
  *(রিকোয়েস্টগুলোর তালিকা পেজিনেশন সহ রিটার্ন করে)*

#### 📌 10. Review Role Change Request (Approve/Reject)
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/users/role-change-requests/{{requestId}}/review`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "decision": "APPROVED",
    "reviewNote": "Approved based on the mid-year performance review."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  সুপার এডমিন বা ম্যানেজার দ্বারা রোল পরিবর্তনের রিকোয়েস্টটি মঞ্জুর (APPROVED) বা বাতিল (REJECTED) করতে এটি ব্যবহার করা হয়।
  অ্যাপ্রুভ করা হলে ইউজারের রোল সিস্টেমে অটোমেটিক আপডেট হয়ে যায়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "id": "cm3z_req_98765",
      "status": "APPROVED",
      "reviewedById": "cm3z_reviewer_111",
      "reviewNote": "Approved based on the mid-year performance review."
    },
    "timestamp": "2026-07-05T17:00:00.000Z"
  }
  ```

#### 📌 11. Cancel Role Change Request
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/users/role-change-requests/{{requestId}}/cancel`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "reason": "Decided to apply later next quarter."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  রোল পরিবর্তনের আবেদনটি প্রসেস হওয়ার পূর্বেই আবেদনকারী নিজে চাইলে সেটি উইথড্র বা বাতিল করতে এটি ব্যবহার করেন।
  এতে রিকোয়েস্টটির স্ট্যাটাস পরিবর্তন হয়ে `CANCELED` হয়ে যায়।
* **Expected Response (200 OK):**
  *(ক্যান্সেলড রিকোয়েস্টের বিবরণী রিটার্ন করে)*

---

### 3️⃣ Teams Module (`/teams`)

> ⚠️ **গুরুত্বপূর্ণ:** সব রিকোয়েস্টে `x-organization-id` হেডার অথবা কুয়েরি প্যারামিটার থাকা আবশ্যক।

#### 📌 1. Create a Team
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/teams`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "name": "Backend Team",
    "slug": "backend-team",
    "description": "Responsible for core APIs and databases.",
    "leaderId": "cm3z11111111111111111111a"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনের অধীনে নতুন একটি কাজের টিম তৈরি করতে এই রুটটি ব্যবহার করা হয়।
  টিম লিডার অ্যাসাইন করা এবং কাজের ক্যাটাগরি ভাগ করার প্রথম ধাপ এটি।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_team_1111",
      "name": "Backend Team",
      "slug": "backend-team",
      "description": "Responsible for core APIs and databases.",
      "organizationId": "cm3z22222222222222222222b",
      "leaderId": "cm3z11111111111111111111a"
    },
    "timestamp": "2026-07-05T17:01:00.000Z"
  }
  ```

#### 📌 2. List Teams
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/teams?page=1&limit=10&search=Backend`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  একটি অর্গানাইজেশনের আওতাধীন সমস্ত টিমের লিস্ট অনুসন্ধান এবং পেজিনেশন সহ ভিউ করতে এটি ব্যবহার করা হয়।
  টিমগুলোর প্রোফাইল ও কার্যকারিতা দ্রুত দেখতে এই রুটটি প্রয়োজনীয়।
* **Expected Response (200 OK):**
  *(সবগুলো টিমের তথ্য সম্বলিত এরে রিটার্ন করবে)*

#### 📌 3. Get Specific Team Details
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/teams/{{teamId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  যেকোনো একটি নির্দিষ্ট টিমের বিস্তারিত বিবরণ এবং টিম মেম্বারদের লিস্ট সহ দেখতে এটি ব্যবহার করা হয়।
  টিমের সামগ্রিক পারফরম্যান্স ও মেম্বার কাউন্ট ট্র্যাক করার জন্য এটি দরকারি।
* **Expected Response (200 OK):**
  *(টিম অবজেক্ট তার মেম্বারদের রিলেশন সহ রিটার্ন করবে)*

#### 📌 4. Update Team Information
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/teams/{{teamId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "name": "Super Backend Team",
    "description": "Handles API scaling, optimization, and databases."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  টিমের নাম, স্লাগ বা ডেসক্রিপশন আপডেট করার জন্য এই রুটটি ব্যবহার করা হয়।
  এটি PATCH হওয়ায় শুধু যেসব ফিল্ড পাঠানো হবে সেগুলোই ডাটাবেজে আপডেট করবে।
* **Expected Response (200 OK):**
  *(আপডেটেড টিম ডিটেইলস রিটার্ন করে)*

#### 📌 5. Delete a Team
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/teams/{{teamId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  কোনো টিম যদি নিষ্ক্রিয় বা অপ্রয়োজনীয় হয়ে যায়, তবে তা সিসটেম থেকে পুরোপুরি রিমুভ করতে এটি ব্যবহার করা হয়।
  এটি ডিলিট করার আগে টিম মেম্বারদের অ্যাসাইনমেন্টগুলো রিলিজ করে দেয়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Team deleted successfully"
    },
    "timestamp": "2026-07-05T17:02:00.000Z"
  }
  ```

#### 📌 6. Add Team Member
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/teams/{{teamId}}/members`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "userId": "cm3z_member_555"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  কোনো ইউজারকে একটি নির্দিষ্ট টিমের সদস্য বা মেম্বার হিসেবে যুক্ত করতে এটি ব্যবহার করা হয়।
  মেম্বার অ্যাড করার পর সে ওই টিমের অধীনে থাকা সব প্রজেক্টে কন্ট্রিবিউট করার সুযোগ পেতে পারে।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "teamId": "cm3z_team_1111",
      "userId": "cm3z_member_555",
      "joinedAt": "2026-07-05T17:03:00.000Z"
    },
    "timestamp": "2026-07-05T17:03:00.000Z"
  }
  ```

#### 📌 7. Remove Team Member
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/teams/{{teamId}}/members/{{userId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  টিম থেকে কোনো মেম্বারকে বাদ দেওয়ার বা তার কন্ট্রিবিউশন রিমুভ করার জন্য এই রুটটি ব্যবহার করা হয়।
  এটি মেম্বারকে টিমের কোলাবোরেশন স্পেস থেকে ডিসকানেক্ট করে দেয়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Member removed from team successfully"
    },
    "timestamp": "2026-07-05T17:04:00.000Z"
  }
  ```

---

### 4️⃣ Projects Module (`/projects`)

> ⚠️ **গুরুত্বপূর্ণ:** সব রিকোয়েস্টে `x-organization-id` হেডার থাকা আবশ্যক।

#### 📌 1. Create a Project
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/projects`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "name": "TaskFlow Application",
    "slug": "taskflow-app",
    "description": "A collaborative task management system.",
    "teamId": "cm3z_team_1111",
    "startDate": "2026-07-10T00:00:00.000Z",
    "endDate": "2026-12-31T23:59:59.000Z"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনের অধীনে নতুন প্রজেক্ট (যেমন- Healthcare System, TaskFlow App) সেটআপ ও শুরু করতে এটি ব্যবহার করা হয়।
  প্রজেক্টের জন্য নির্দিষ্ট টাইমলাইন এবং টিম অ্যাসাইনমেন্ট এর মাধ্যমে শুরু করা যায়।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_project_7777",
      "name": "TaskFlow Application",
      "slug": "taskflow-app",
      "status": "ACTIVE",
      "teamId": "cm3z_team_1111"
    },
    "timestamp": "2026-07-05T17:05:00.000Z"
  }
  ```

#### 📌 2. List Projects
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/projects?page=1&limit=10&status=ACTIVE`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনের সব একটিভ বা অন্যান্য স্ট্যাটাসযুক্ত প্রজেক্টের লিস্ট দেখতে এটি ব্যবহার করা হয়।
  প্রজেক্ট ট্র্যাকিং এবং ওভারভিউ পাওয়ার জন্য এই ফিল্টার সুবিধাযুক্ত রুটটি দরকারি।
* **Expected Response (200 OK):**
  *(সব প্রজেক্টের তালিকা রিটার্ন করবে)*

#### 📌 3. Get Project Details
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/projects/{{projectId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  নির্দিষ্ট একটি প্রজেক্টের বিস্তারিত প্রগ্রেস বা যুক্ত মেম্বারদের দেখতে এটি ব্যবহার করা হয়।
  প্রজেক্ট ড্যাশবোর্ডে ডিটেইলস লোড করতে এটি ব্যবহার করা হয়।
* **Expected Response (200 OK):**
  *(প্রজেক্ট অবজেক্ট মেম্বারদের তালিকা সহ রিটার্ন করবে)*

#### 📌 4. Update Project Details
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/projects/{{projectId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "status": "ON_HOLD",
    "description": "Project paused temporarily awaiting feedback."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  প্রজেক্টের কাজের গতি অনুযায়ী প্রজেক্টের স্ট্যাটাস (যেমন: ACTIVE থেকে COMPLETED বা ON_HOLD) আপডেট করতে এটি ব্যবহৃত হয়।
  টাইমলাইন বা বর্ণনা পরিবর্তন করতেও এটি ব্যবহার করা যায়।
* **Expected Response (200 OK):**
  *(আপডেটেড প্রজেক্ট ডিটেইলস)*

#### 📌 5. Delete Project
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/projects/{{projectId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  বাতিল হয়ে যাওয়া বা অপ্রয়োজনীয় প্রজেক্ট চিরতরে ডাটাবেজ থেকে মুছে ফেলার জন্য এটি ব্যবহার করা হয়।
  এটি সতর্কতার সাথে করা উচিত কারণ প্রজেক্টের সাথে যুক্ত সব কাজও এতে মুছে যেতে পারে।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Project deleted successfully"
    },
    "timestamp": "2026-07-05T17:06:00.000Z"
  }
  ```

#### 📌 6. Add Project Member
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/projects/{{projectId}}/members`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "userId": "cm3z_member_555"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  টিমের বাইরে থেকেও কোনো নির্দিষ্ট ইউজারকে সরাসরি কোনো প্রজেক্টে কাজ করার জন্য এক্সেস দিতে এটি ব্যবহার করা হয়।
  প্রজেক্টে কোলাবোরেট করার জন্য ইউজারকে মেম্বার তালিকায় যোগ করা হয়।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "projectId": "cm3z_project_7777",
      "userId": "cm3z_member_555"
    },
    "timestamp": "2026-07-05T17:07:00.000Z"
  }
  ```

#### 📌 7. Remove Project Member
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/projects/{{projectId}}/members/{{userId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  কোনো মেম্বারকে প্রজেক্টের কাজ থেকে অব্যাহতি দেওয়ার বা রিমুভ করার জন্য এটি ব্যবহার করা হয়।
  রিমুভ করার পর মেম্বার ওই প্রজেক্টের ড্যাশবোর্ড বা ফাইল এক্সেস করতে পারবে না।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Member removed from project successfully"
    },
    "timestamp": "2026-07-05T17:08:00.000Z"
  }
  ```

---

### 5️⃣ Tasks Module (`/tasks`)

> ⚠️ **গুরুত্বপূর্ণ:** সব রিকোয়েস্টে `x-organization-id` হেডার পাঠানো লাগবে।

#### 📌 1. Create a Task
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/tasks`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "projectId": "cm3z_project_7777",
    "title": "Design Database Schema",
    "description": "Create ERD and initial Prisma migrations for the task flow.",
    "priority": "HIGH",
    "assigneeId": "cm3z11111111111111111111a",
    "deadline": "2026-07-15T23:59:59.000Z",
    "estimatedHours": 6,
    "tags": "database, schema, backend"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  একটি প্রজেক্টের কাজের অংশ হিসেবে নতুন একটি টাস্ক বা দায়িত্ব তৈরি করতে এই রুটটি ব্যবহার করা হয়।
  এতে কাজের ডেসক্রিপশন, ডেডলাইন, এবং কাজের গুরুত্ব (Priority) সেট করা যায়।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_task_9999",
      "title": "Design Database Schema",
      "status": "TODO",
      "priority": "HIGH",
      "projectId": "cm3z_project_7777",
      "assigneeId": "cm3z11111111111111111111a"
    },
    "timestamp": "2026-07-05T17:09:00.000Z"
  }
  ```

#### 📌 2. List Tasks
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/tasks?page=1&limit=10&status=TODO`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনের সব টাস্কগুলোর তালিকা (প্রজেক্ট আইডি বা স্ট্যাটাস ফিল্টারিং সহ) দেখতে এটি ব্যবহার করা হয়।
  কাজের বর্তমান অগ্রগতি এবং কার কোন কাজ পেন্ডিং তা তদারক করার জন্য এটি দরকারি।
* **Expected Response (200 OK):**
  *(সব টাস্কের তালিকা পেজিনেশন সহ রিটার্ন করবে)*

#### 📌 3. Get My Tasks
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/tasks/my?page=1&limit=10&status=IN_PROGRESS`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  বর্তমানে লগইন করা মেম্বারের নিজের কাজগুলোর তালিকা ফিল্টার ও সার্চ করে দেখার জন্য এটি ব্যবহার করা হয়।
  ইউজারদের তার নিজস্ব আজকের কাজ দেখতে বা ড্যাশবোর্ড লোড করতে এই রুটটি অতি প্রয়োজনীয়।
* **Expected Response (200 OK):**
  *(শুধুমাত্র ইউজারের নিজের কাজের অবজেক্ট এরে রিটার্ন করবে)*

#### 📌 4. Get Task Details
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/tasks/{{taskId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  একটি নির্দিষ্ট কাজের ফাইল এটাচমেন্ট, কমেন্ট বা সাব-টাস্ক সহ সম্পূর্ণ ডাটা লোড করার জন্য এটি ব্যবহৃত হয়।
  টাস্কের সম্পূর্ণ লাইফসাইকেল বা ডেসক্রিপশন দেখতে এটি ব্যবহার করুন।
* **Expected Response (200 OK):**
  *(টাস্কের ডিটেইলস অবজেক্ট রিটার্ন করে)*

#### 📌 5. Update Task Details
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/tasks/{{taskId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "title": "Design Database Schema (ERD)",
    "priority": "URGENT",
    "estimatedHours": 8
  }
  ```
* **ব্যাখ্যা (Explanation):**
  কাজের প্রয়োজনীয়তা পরিবর্তনের সাথে সাথে টাস্কের টাইটেল, ডেসক্রিপশন বা এস্টিমেটেড আওয়ারস আপডেট করতে এটি ব্যবহৃত হয়।
  এটি শুধু পাঠানো ফিল্ডগুলোকেই ডাটাবেজে আপডেট করবে।
* **Expected Response (200 OK):**
  *(আপডেটেড টাস্ক অবজেক্ট)*

#### 📌 6. Update Task Status
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/tasks/{{taskId}}/status`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "status": "IN_PROGRESS"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  কাজের অগ্রগতি ট্র্যাকিংয়ের জন্য টাস্কের স্ট্যাটাস (যেমন: TODO থেকে IN_PROGRESS বা DONE) পরিবর্তন করতে ব্যবহৃত হয়।
  স্ট্যাটাস চেঞ্জ হলে টিমের অন্য মেম্বারদের কাছে নোটিফিকেশন চলে যায়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "id": "cm3z_task_9999",
      "status": "IN_PROGRESS"
    },
    "timestamp": "2026-07-05T17:10:00.000Z"
  }
  ```

#### 📌 7. Assign Task to User
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/tasks/{{taskId}}/assign`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "assigneeId": "cm3z_member_555"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  কোনো কাজ অন্য মেম্বারকে করার দায়িত্ব দেওয়ার বা এসাইনি পরিবর্তন করার জন্য এটি ব্যবহৃত হয়।
  এসাইন সম্পন্ন হলে নতুন এসাইনি তার ড্যাশবোর্ডে কাজটি দেখতে পায়।
* **Expected Response (200 OK):**
  *(নতুন এসাইনি যুক্ত টাস্ক অবজেক্ট)*

#### 📌 8. Delete a Task
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/tasks/{{taskId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  ভুলবশত ক্রিয়েট হওয়া বা বাতিল হয়ে যাওয়া কোনো টাস্ক মুছে ফেলার জন্য এই রুটটি ব্যবহার করা হয়।
  এটি ডিলিট করলে কাজটির সাথে যুক্ত সমস্ত অ্যাক্টিভিটি হিস্ট্রিও ডিলিট হয়ে যায়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Task deleted successfully"
    },
    "timestamp": "2026-07-05T17:11:00.000Z"
  }
  ```

---

### 6️⃣ Comments Module (`/comments` - Task Comments)

> ⚠️ **গুরুত্বপূর্ণ:** সব রিকোয়েস্টে `x-organization-id` হেডার পাঠানো লাগবে।

#### 📌 1. Add Comment to Task
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/tasks/{{taskId}}/comments`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "body": "Database schema draft is ready. Review migrations before applying."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  কোনো কাজের আপডেট বা কুইক ফিডব্যাক দেওয়ার জন্য টাস্কের নিচে কমেন্ট যুক্ত করতে এটি ব্যবহার করা হয়।
  কমিউনিকেশন ভালো রাখতে এটি কাজ করে এবং প্রজেক্টের সবাই এটি দেখতে পারে।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_comment_123",
      "body": "Database schema draft is ready. Review migrations before applying.",
      "taskId": "cm3z_task_9999",
      "authorId": "cm3z11111111111111111111a"
    },
    "timestamp": "2026-07-05T17:12:00.000Z"
  }
  ```

#### 📌 2. List Task Comments
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/tasks/{{taskId}}/comments?page=1&limit=10`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  একটি নির্দিষ্ট টাস্কের নিচে করা সমস্ত কমেন্টের তালিকা পেজিনেশন আকারে দেখতে এই রুটটি ব্যবহার করা হয়।
  টাস্কের অধীনে কথোপকথন ট্র্যাকিং এবং কমেন্ট লোড করার জন্য এটি দরকারি।
* **Expected Response (200 OK):**
  *(কমেন্টগুলোর পেজিনেটেড তালিকা রেসপন্স আকারে রিটার্ন করে)*

#### 📌 3. Update Comment
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/comments/{{commentId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "body": "Database schema is updated and ready. Migrations executed."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  ইউজার তার পূর্বে করা ভুল বা অসম্পূর্ণ কোনো কমেন্ট এডিট বা সংশোধন করতে এটি ব্যবহার করতে পারেন।
  শুধুমাত্র ওই নির্দিষ্ট কমেন্টটির রাইটারই এটি এডিট করার পারমিশন পায়।
* **Expected Response (200 OK):**
  *(আপডেটেড কমেন্ট অবজেক্ট)*

#### 📌 4. Delete Comment
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/comments/{{commentId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  পূর্বে করা কোনো কমেন্ট ডিলিট বা চিরতরে মুছে ফেলার জন্য এই রুটটি ব্যবহার করা হয়।
  এটি কমেন্ট রেকর্ডটি ডাটাবেজ থেকে রিমুভ করে দেয়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Comment deleted successfully"
    },
    "timestamp": "2026-07-05T17:13:00.000Z"
  }
  ```

---

### 7️⃣ Attachments Module (`/attachments` - File Upload Links)

> ⚠️ **গুরুত্বপূর্ণ:** সব রিকোয়েস্টে `x-organization-id` হেডার পাঠানো লাগবে।

#### 📌 1. Create File Attachment
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/attachments`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "entityType": "TASK",
    "taskId": "cm3z_task_9999",
    "fileName": "db_erd.png",
    "fileUrl": "https://storage.googleapis.com/taskflow-bucket/db_erd.png",
    "fileSize": 1048576,
    "mimeType": "image/png"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  কোনো কাজ, প্রজেক্ট বা কমেন্টের সাথে প্রয়োজনীয় ডকুমেন্ট, স্ক্রিনশট বা ফাইল অ্যাড করতে এটি ব্যবহৃত হয়।
  ফাইলটি ক্লাউড স্টোরেজে আপলোড হওয়ার পর তার ইউআরএল ও মেটাডাটা এখানে স্টোর করতে হয়।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_attach_555",
      "fileName": "db_erd.png",
      "fileUrl": "https://storage.googleapis.com/taskflow-bucket/db_erd.png",
      "taskId": "cm3z_task_9999"
    },
    "timestamp": "2026-07-05T17:14:00.000Z"
  }
  ```

#### 📌 2. List Task Attachments
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/tasks/{{taskId}}/attachments`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  একটি নির্দিষ্ট টাস্কের সাথে যুক্ত করা সব ফাইল এবং এটাচমেন্টের তালিকা পাওয়ার জন্য এটি ব্যবহার করা হয়।
  সহজেই টাস্ক সম্পর্কিত রিসোর্স বা অ্যাসেট ডাউনলোড করতে এই রুটটি দরকার পড়ে।
* **Expected Response (200 OK):**
  *(সব ফাইল এটাচমেন্টের এরে লিস্ট রিটার্ন করবে)*

#### 📌 3. Delete Attachment
* **HTTP Method:** `DELETE`
* **Route:** `{{base_url}}/attachments/{{attachmentId}}`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  ভুল করে আপলোড করা বা অপ্রয়োজনীয় ফাইল এটাচমেন্ট সিসটেম থেকে ডিলিট বা রিমুভ করার জন্য এটি ব্যবহার করা হয়।
  এটি ডাটাবেজ থেকে এটাচমেন্ট রেকর্ডটি রিমুভ করে দেয়।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "message": "Attachment deleted successfully"
    },
    "timestamp": "2026-07-05T17:15:00.000Z"
  }
  ```

---

### 8️⃣ Invitations Module (`/invitations`)

#### 📌 1. Send Invitation to New Member
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/invitations`
* **Headers:** `x-organization-id: {{organizationId}}`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "email": "jane.smith@example.com",
    "message": "Join our organization Acme Corp on TaskFlow to collaborate on projects."
  }
  ```
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনের বাইরে থাকা কোনো নতুন ইউজারের কাছে ইমেইলের মাধ্যমে যোগ দেওয়ার আমন্ত্রন পত্র পাঠাতে এটি ব্যবহার করা হয়।
  ইউজারের ইমেইলে একটি ভ্যালিড জয়েনিং টোকেন পাঠানো হয় যা দিয়ে সে পরবর্তীতে অ্যাকাউন্ট ক্রিয়েট করতে পারবে।
* **Expected Response (201 Created):**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "data": {
      "id": "cm3z_invite_333",
      "email": "jane.smith@example.com",
      "status": "PENDING"
    },
    "timestamp": "2026-07-05T17:16:00.000Z"
  }
  ```

#### 📌 2. Accept Invitation (Join / Create Account)
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/invitations/accept`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "token": "jane-smith-invitation-token-12345",
    "firstName": "Jane",
    "lastName": "Smith",
    "displayName": "Jane Smith",
    "password": "Password123!"
  }
  ```
* **ব্যাখ্যা (Explanation):**
  ইমেইলের আমন্ত্রণ লিংকের টোকেন ও নতুন পাসওয়ার্ড দিয়ে নতুন ইউজার হিসেবে অর্গানাইজেশনে জয়েন করতে এটি ব্যবহার করা হয়।
  এটি কোনো পূর্ব অ্যাকাউন্ট ছাড়াই সরাসরি সিস্টেমে মেম্বার অ্যাকাউন্ট জেনারেট করে লগইন করিয়ে দেয়।
* **Expected Response (201 Created):**
  *(সফল জয়েনিং ইনফো এবং সেশন কুকি রিটার্ন করবে)*

#### 📌 3. List Sent Invitations
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/invitations?page=1&limit=10&status=PENDING`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনে পাঠানো সমস্ত আমন্ত্রণের তালিকা এবং তাদের বর্তমান অবস্থা (কে অ্যাক্সেপ্ট করেছে বা পেন্ডিং আছে) দেখতে ব্যবহার করা হয়।
  অর্গানাইজেশন মেম্বার ম্যানেজমেন্টের জন্য এটি অত্যন্ত কাজের।
* **Expected Response (200 OK):**
  *(ইনভাইটেশন লিস্ট রিটার্ন করবে)*

#### 📌 4. Resend Invitation
* **HTTP Method:** `POST`
* **Route:** `{{base_url}}/invitations/{{invitationId}}/resend`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  আমন্ত্রন লিংক হারিয়ে গেলে বা মেয়াদ শেষ হয়ে গেলে নতুন টোকেন জেনারেট করে আবার ইমেইল পাঠাতে এটি ব্যবহৃত হয়।
  এতে মেম্বারকে পুনরায় নোটিফাই করা সহজ হয়।
* **Expected Response (200 OK):**
  *(রিসেন্ড স্ট্যাটাস ও সাকসেস মেসেজ রিটার্ন করবে)*

#### 📌 5. Cancel Invitation
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/invitations/{{invitationId}}/cancel`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  ভুল ইমেইলে ইনভাইটেশন পাঠানো হয়ে থাকলে তা পেন্ডিং থাকাবস্থায় বাতিল করতে এই রুটটি ব্যবহার করা হয়।
  বাতিল করার পর ওই লিংকে থাকা টোকেনটি দিয়ে সিস্টেমে জয়েন করা সম্ভব হয় না।
* **Expected Response (200 OK):**
  *(ক্যান্সেলড ইনভাইটেশনের অবজেক্ট)*

---

### 9️⃣ Notifications Module (`/notifications`)

#### 📌 1. List Notifications
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/notifications?page=1&limit=10`
* **ব্যাখ্যা (Explanation):**
  ইউজারের নিজের সমস্ত নোটিফিকেশনের তালিকা (যেমন: নতুন কাজ অ্যাসাইন হওয়া, নতুন কমেন্ট পাওয়া) পেজিনেটেড আকারে পেতে ব্যবহৃত হয়।
  ড্যাশবোর্ডের নোটিফিকেশন আইকন বা প্যানেল রেন্ডার করার জন্য এটি ব্যবহার করা হয়।
* **Expected Response (200 OK):**
  *(নোটিফিকেশন গুলোর এরে অবজেক্ট রিটার্ন করে)*

#### 📌 2. Unread Notifications Count
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/notifications/unread-count`
* **ব্যাখ্যা (Explanation):**
  ইউজারের ইনবক্সে বর্তমানে মোট কয়টি নোটিফিকেশন না পড়া (Unread) অবস্থায় আছে তা জানতে এটি ব্যবহার করা হয়।
  নোটিফিকেশন বেল আইকনে রেড ব্যাজ কাউন্ট দেখানোর জন্য এই রুটটি দরকার পড়ে।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "count": 5
    },
    "timestamp": "2026-07-05T17:17:00.000Z"
  }
  ```

#### 📌 3. Mark Notifications as Read
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/notifications/read`
* **Request Body (Dummy Data - JSON):**
  ```json
  {
    "notificationIds": ["cm3z_noti_1", "cm3z_noti_2"]
  }
  ```
* **ব্যাখ্যা (Explanation):**
  ইউজার নির্দিষ্ট এক বা একাধিক নোটিফিকেশন দেখার পর সেগুলোকে পড়া বা 'Read' হিসেবে চিহ্নিত করতে এটি ব্যবহার করেন।
  এতে আনরিড কাউন্ট থেকে নোটিফিকেশনগুলো কমে যায়।
* **Expected Response (200 OK):**
  *(সাকসেস মেসেজ ও আপডেটেড নোটিফিকেশন কাউন্ট)*

#### 📌 4. Mark All Notifications as Read
* **HTTP Method:** `PATCH`
* **Route:** `{{base_url}}/notifications/read-all`
* **ব্যাখ্যা (Explanation):**
  ইউজারের সমস্ত পেন্ডিং নোটিফিকেশনকে একসাথে পঠিত বা 'Read' হিসেবে চিহ্নিত করতে এটি ব্যবহার করা হয়।
  এতে একসাথে সবগুলো নোটিফিকেশনের রেড ব্যাজ বা কাউন্ট জিরো হয়ে যায়।
* **Expected Response (200 OK):**
  *(সাকসেস রেসপন্স)*

---

### 🔟 Activity Log Module (`/activity` & `/tasks/:taskId/activity`)

> ⚠️ **গুরুত্বপূর্ণ:** সব রিকোয়েস্টে `x-organization-id` হেডার পাঠানো লাগবে।

#### 📌 1. List Organization Activity Log
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/activity?page=1&limit=20`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  অর্গানাইজেশনের সমস্ত মেম্বারদের গুরুত্বপূর্ণ কাজের হিস্ট্রি এবং অ্যাকশন অডিট ট্রেইল আকারে দেখতে এটি ব্যবহার করা হয়।
  ম্যানেজারদের অর্গানাইজেশনের সামগ্রিক খবরাখবর এবং কাজের আপডেট পেতে এই রুটটি দরকার হয়।
* **Expected Response (200 OK):**
  *(অর্গানাইজেশনের কাজের পেজিনেটেড অডিট লগ লিস্ট রিটার্ন করবে)*

#### 📌 2. List Specific Task Activity Log
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/tasks/{{taskId}}/activity?page=1&limit=10`
* **Headers:** `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  একটি নির্দিষ্ট টাস্কের অধীনে শুরু থেকে শেষ পর্যন্ত কে কোন পরিবর্তন করেছে তার ডিটেইল হিস্ট্রি দেখতে এটি ব্যবহৃত হয়।
  টাস্কের স্ট্যাটাস বা প্রায়োরিটি পরিবর্তন কখন কে করেছে তা নিখুঁতভাবে চেক করার জন্য এটি দরকারি।
* **Expected Response (200 OK):**
  *(কাজের লগ বা অ্যাক্টিভিটি ডিটেইল এরে)*

---

### 1️⃣1️⃣ Health Module (`/health` & Application Roots)

#### 📌 1. Basic Health Check
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/health`
* **ব্যাখ্যা (Explanation):**
  ব্যাকএন্ড সার্ভিস ও ডাটাবেজ সচল বা অনলাইন আছে কিনা তা খুব দ্রুত মনিটর করতে এটি ব্যবহার করা হয়।
  সার্ভিসের ডাউনটাইম ও মেমোরি কনসাম্পশন চেক করার জন্য সিস্টেম এটি সয়ংক্রিয়ভাবে কল করতে পারে।
* **Expected Response (200 OK):**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "data": {
      "status": "ok",
      "timestamp": "2026-07-05T17:18:00.000Z",
      "uptime": 1254,
      "memory": {
        "heapUsed": "48MB",
        "heapTotal": "80MB"
      },
      "services": {
        "database": "ok"
      }
    },
    "timestamp": "2026-07-05T17:18:00.000Z"
  }
  ```

#### 📌 2. Basic Greeting (Root check)
* **HTTP Method:** `GET`
* **Route:** `http://localhost:5000` (অথবা `/api/v1`)
* **ব্যাখ্যা (Explanation):**
  সার্ভারটি রান করছে কিনা তার প্রাথমিক পরীক্ষার জন্য এই রুটটি ব্যবহার করা হয়।
  এটি সরাসরি সার্ভারের রুট ইউআরএল-এ রিকোয়েস্ট পাঠিয়ে সাকসেস মেসেজ নিশ্চিত করে।
* **Expected Response (200 OK):**
  `Hello World!` (বা অনুরূপ স্ট্রিং মেসেজ)

#### 📌 3. Admin Health
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/admin/health`
* **Headers:** `Authorization: Bearer {{accessToken}}` (শুধুমাত্র SUPER_ADMIN জন্য)
* **ব্যাখ্যা (Explanation):**
  সুপার এডমিনের জন্য পুরো সিস্টেম ও অ্যাপ্লিকেশনের বিশেষ পারফরম্যান্স ও ব্যাকএন্ড হেলথ চেক করতে এটি ব্যবহার করা হয়।
  অন্য কোনো রোলের ইউজার এটি কল করলে `403 Forbidden` ইরর দেখাবে।
* **Expected Response (200 OK):**
  *(এডমিন সম্পর্কিত বিশেষ মেটাডাটা ও হেলথ স্ট্যাটাস)*

#### 📌 4. Organization Health
* **HTTP Method:** `GET`
* **Route:** `{{base_url}}/organization/health`
* **Headers:** `Authorization: Bearer {{accessToken}}`, `x-organization-id: {{organizationId}}`
* **ব্যাখ্যা (Explanation):**
  নির্দিষ্ট অর্গানাইজেশনের অ্যাক্টিভ স্ট্যাটাস ও মেম্বার স্বাস্থ্য সম্পর্কিত ম্যাট্রিক্স দেখতে অর্গানাইজেশন মেম্বারদের জন্য এটি ব্যবহার করা হয়।
  এটি ম্যানেজার বা মেম্বারদের অর্গানাইজেশনের সচলতার খবর দিতে সাহায্য করে।
* **Expected Response (200 OK):**
  *(অর্গানাইজেশন সম্পর্কিত হেলথ স্ট্যাটাস)*

---
*(এই `test.md` ফাইলটি দিয়ে আপনি Postman-এ সরাসরি রিকোয়েস্ট তৈরি করে সব ডাটা এবং কোডবেস নির্ভুলভাবে চেক করতে পারবেন)*
