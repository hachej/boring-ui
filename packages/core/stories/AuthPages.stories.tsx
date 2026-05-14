import React from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { MemoryRouter } from "react-router-dom"
import { SignInPage } from "../src/front/auth/SignInPage"
import { SignUpPage } from "../src/front/auth/SignUpPage"
import { ForgotPasswordPage } from "../src/front/auth/ForgotPasswordPage"
import { ResetPasswordPage } from "../src/front/auth/ResetPasswordPage"
import { VerifyEmailPage } from "../src/front/auth/VerifyEmailPage"
import { UserSettingsPage } from "../src/front/auth/UserSettingsPage"
import { AuthProvider } from "../src/front/auth/AuthProvider"
import { UserIdentityProvider } from "../src/front/auth/UserIdentityProvider"
import { withAuthDecorator } from "./auth-decorators"

// ─── SignInPage ──────────────────────────────────────────────────────

const signInMeta: Meta<typeof SignInPage> = {
  title: "Auth/SignInPage",
  component: SignInPage,
  tags: ["autodocs"],
  decorators: [withAuthDecorator],
  parameters: { layout: "fullscreen" },
}

export default signInMeta
type SignInStory = StoryObj<typeof SignInPage>

export const Default: SignInStory = {}

// ─── SignUpPage ──────────────────────────────────────────────────────

export const SignUp: StoryObj<typeof SignUpPage> = {
  render: () => <SignUpPage />,
  decorators: [withAuthDecorator],
  parameters: { layout: "fullscreen" },
}

// ─── SignUpPage with invite token ────────────────────────────────────

export const SignUpWithInvite: StoryObj<typeof SignUpPage> = {
  render: () => (
    <MemoryRouter initialEntries={["/auth/signup?invite_token=abc123"]}>
      <SignUpPage />
    </MemoryRouter>
  ),
  parameters: { layout: "fullscreen" },
}

// ─── ForgotPasswordPage ──────────────────────────────────────────────

export const ForgotPassword: StoryObj<typeof ForgotPasswordPage> = {
  render: () => <ForgotPasswordPage />,
  decorators: [withAuthDecorator],
  parameters: { layout: "fullscreen" },
}

// ─── ResetPasswordPage ──────────────────────────────────────────────

export const ResetPasswordWithToken: StoryObj<typeof ResetPasswordPage> = {
  render: () => <ResetPasswordPage />,
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/auth/reset-password?token=mock-token"]}>
        <Story />
      </MemoryRouter>
    ),
  ],
  parameters: { layout: "fullscreen" },
}

export const ResetPasswordExpired: StoryObj<typeof ResetPasswordPage> = {
  render: () => <ResetPasswordPage />,
  decorators: [withAuthDecorator],
  parameters: { layout: "fullscreen" },
}

// ─── VerifyEmailPage ─────────────────────────────────────────────────

export const VerifyEmailNoToken: StoryObj<typeof VerifyEmailPage> = {
  render: () => <VerifyEmailPage />,
  decorators: [withAuthDecorator],
  parameters: { layout: "fullscreen" },
}

export const VerifyEmailWithToken: StoryObj<typeof VerifyEmailPage> = {
  render: () => <VerifyEmailPage />,
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/auth/verify-email?token=mock-token"]}>
        <Story />
      </MemoryRouter>
    ),
  ],
  parameters: { layout: "fullscreen" },
}

// ─── UserSettingsPage ────────────────────────────────────────────────

export const UserSettings: StoryObj<typeof UserSettingsPage> = {
  render: () => (
    <AuthProvider>
      <UserIdentityProvider>
        <UserSettingsPage />
      </UserIdentityProvider>
    </AuthProvider>
  ),
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  parameters: { layout: "fullscreen" },
}
