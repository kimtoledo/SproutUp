'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  ButtonLink,
  Field,
  Input,
  PageHeading,
  RadioCards,
  SiteHeader,
  Textarea,
} from '@/components/ui';
import { loadPortal, type PortalCase, type PortalSession } from '@/lib/portal-client';
import {
  loadBorrowerProfile,
  saveBorrowerProfile,
  type BeneficialOwnerInput,
  type BorrowerEntityType,
  type BorrowerProfile,
  type BorrowerProfileInput,
} from '@/lib/borrower-profile-client';
import {
  loadInvestorProfile,
  saveInvestorProfile,
  type InvestorProfile,
  type InvestorProfileInput,
} from '@/lib/investor-profile-client';

const editableStatuses = new Set(['draft', 'needs_information']);

type LoadState =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  | { phase: 'unavailable' }
  | { phase: 'no-case' }
  | { phase: 'ready'; session: PortalSession; onboardingCase: PortalCase };

export default function BorrowerOrInvestorProfilePage() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    void loadPortal().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setState({ phase: result.reason === 'unauthenticated' ? 'unauthenticated' : 'unavailable' });
        return;
      }
      const relevant = result.cases
        .filter((item) => item.caseType === result.session.accountType)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const onboardingCase = relevant.find((item) => editableStatuses.has(item.status)) ?? relevant[0];
      if (!onboardingCase) {
        setState({ phase: 'no-case' });
        return;
      }
      setState({ phase: 'ready', session: result.session, onboardingCase });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-[100dvh]">
      <SiteHeader
        brand="SproutUp"
        right={
          <Link className="font-semibold text-primary underline-offset-4 hover:underline" href="/portal">
            <ArrowLeft aria-hidden="true" className="mr-1 inline" size={16} />
            Back to portal
          </Link>
        }
      />
      <section className="mx-auto max-w-content px-5 py-10">
        {state.phase === 'loading' ? (
          <p className="text-muted-foreground">Loading your profile…</p>
        ) : state.phase === 'unauthenticated' ? (
          <Alert tone="warning" title="Your session is required.">
            <Link className="font-semibold underline-offset-4 hover:underline" href="/login">
              Sign in to continue.
            </Link>
          </Alert>
        ) : state.phase === 'unavailable' ? (
          <Alert tone="danger" title="The portal is temporarily unavailable.">
            Please retry in a moment.
          </Alert>
        ) : state.phase === 'no-case' ? (
          <Alert tone="info" title="Start your onboarding case first.">
            <p className="mb-3">Your profile is attached to an onboarding case.</p>
            <ButtonLink href="/portal">Go to your portal</ButtonLink>
          </Alert>
        ) : state.session.accountType === 'borrower' ? (
          <BorrowerProfileSection onboardingCase={state.onboardingCase} />
        ) : (
          <InvestorProfileSection onboardingCase={state.onboardingCase} />
        )}
      </section>
    </main>
  );
}

const entityTypeOptions: ReadonlyArray<{ value: BorrowerEntityType; title: string; description: string }> = [
  { value: 'sole_proprietorship', title: 'Sole proprietorship', description: 'DTI-registered single owner' },
  { value: 'partnership', title: 'Partnership', description: 'SEC-registered partnership' },
  { value: 'corporation', title: 'Corporation', description: 'SEC-registered corporation' },
];

function emptyOwner(): BeneficialOwnerInput {
  return { fullName: '', ownershipPercentage: '', nationality: '', isPep: false };
}

function BorrowerProfileSection({ onboardingCase }: { onboardingCase: PortalCase }) {
  const editable = editableStatuses.has(onboardingCase.status);
  const [loaded, setLoaded] = useState<BorrowerProfile | null | undefined>(undefined);
  const [entityType, setEntityType] = useState<BorrowerEntityType>('corporation');
  const [registeredName, setRegisteredName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [tin, setTin] = useState('');
  const [principalAddress, setPrincipalAddress] = useState('');
  const [contactPersonName, setContactPersonName] = useState('');
  const [contactPersonEmail, setContactPersonEmail] = useState('');
  const [contactPersonPhone, setContactPersonPhone] = useState('');
  const [dateEstablished, setDateEstablished] = useState('');
  const [owners, setOwners] = useState<BeneficialOwnerInput[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadBorrowerProfile(onboardingCase.id).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setMessage({ tone: 'danger', text: result.message });
        setLoaded(null);
        return;
      }
      setLoaded(result.profile);
      if (result.profile) {
        setEntityType(result.profile.entityType);
        setRegisteredName(result.profile.registeredName);
        setTradeName(result.profile.tradeName ?? '');
        setRegistrationNumber(result.profile.registrationNumber ?? '');
        setTin(result.profile.tin ?? '');
        setPrincipalAddress(result.profile.principalAddress ?? '');
        setContactPersonName(result.profile.contactPersonName ?? '');
        setContactPersonEmail(result.profile.contactPersonEmail ?? '');
        setContactPersonPhone(result.profile.contactPersonPhone ?? '');
        setDateEstablished(result.profile.dateEstablished ?? '');
        setOwners(result.profile.beneficialOwners.map((owner) => ({
          fullName: owner.fullName,
          ownershipPercentage: owner.ownershipPercentage,
          nationality: owner.nationality ?? '',
          isPep: owner.isPep,
        })));
        setVersion(result.profile.version);
      }
    });
    return () => {
      active = false;
    };
  }, [onboardingCase.id]);

  const totalOwnership = useMemo(
    () => owners.reduce((sum, owner) => sum + (Number.parseFloat(owner.ownershipPercentage) || 0), 0),
    [owners],
  );

  async function submit() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    const input: BorrowerProfileInput = {
      expectedVersion: version,
      entityType,
      registeredName: registeredName.trim(),
      tradeName: tradeName.trim() || undefined,
      registrationNumber: registrationNumber.trim() || undefined,
      tin: tin.trim() || undefined,
      principalAddress: principalAddress.trim() || undefined,
      contactPersonName: contactPersonName.trim() || undefined,
      contactPersonEmail: contactPersonEmail.trim() || undefined,
      contactPersonPhone: contactPersonPhone.trim() || undefined,
      dateEstablished: dateEstablished || undefined,
      beneficialOwners: owners
        .filter((owner) => owner.fullName.trim().length > 0)
        .map((owner) => ({ ...owner, nationality: owner.nationality?.trim() || undefined })),
    };
    const result = await saveBorrowerProfile(onboardingCase.id, input, fetch);
    if (result.ok) {
      setVersion(result.profile.version);
      setMessage({ tone: 'success', text: 'Your business profile has been saved.' });
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
    setPending(false);
  }

  if (loaded === undefined) {
    return <p className="text-muted-foreground">Loading your business profile…</p>;
  }

  return (
    <div className="max-w-2xl">
      <PageHeading
        eyebrow="Borrower profile"
        title="Your business details"
        description={editable
          ? 'This information is reviewed by our compliance team before your case can move forward.'
          : 'Editing is unavailable while this case is in its current state.'}
      />
      <form
        className="mt-8 grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <RadioCards
          legend="Entity type"
          name="entityType"
          onChange={setEntityType}
          options={entityTypeOptions}
          value={entityType}
        />
        <Field label="Registered business name" name="registeredName">
          {(wiring) => (
            <Input
              disabled={!editable}
              maxLength={300}
              onChange={(event) => setRegisteredName(event.target.value)}
              required
              value={registeredName}
              {...wiring}
            />
          )}
        </Field>
        <Field label="Trade name (if different)" name="tradeName">
          {(wiring) => (
            <Input
              disabled={!editable}
              maxLength={300}
              onChange={(event) => setTradeName(event.target.value)}
              value={tradeName}
              {...wiring}
            />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="DTI/SEC registration number" name="registrationNumber">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={100}
                onChange={(event) => setRegistrationNumber(event.target.value)}
                value={registrationNumber}
                {...wiring}
              />
            )}
          </Field>
          <Field label="TIN" name="tin">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={30}
                onChange={(event) => setTin(event.target.value)}
                value={tin}
                {...wiring}
              />
            )}
          </Field>
        </div>
        <Field label="Principal business address" name="principalAddress">
          {(wiring) => (
            <Textarea
              disabled={!editable}
              maxLength={500}
              onChange={(event) => setPrincipalAddress(event.target.value)}
              value={principalAddress}
              {...wiring}
            />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Date established" name="dateEstablished">
            {(wiring) => (
              <Input
                disabled={!editable}
                onChange={(event) => setDateEstablished(event.target.value)}
                type="date"
                value={dateEstablished}
                {...wiring}
              />
            )}
          </Field>
          <Field label="Authorized contact name" name="contactPersonName">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={200}
                onChange={(event) => setContactPersonName(event.target.value)}
                value={contactPersonName}
                {...wiring}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Contact email" name="contactPersonEmail">
            {(wiring) => (
              <Input
                disabled={!editable}
                onChange={(event) => setContactPersonEmail(event.target.value)}
                type="email"
                value={contactPersonEmail}
                {...wiring}
              />
            )}
          </Field>
          <Field label="Contact phone" name="contactPersonPhone">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={30}
                onChange={(event) => setContactPersonPhone(event.target.value)}
                value={contactPersonPhone}
                {...wiring}
              />
            )}
          </Field>
        </div>

        <fieldset className="grid gap-3 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold text-foreground">
            Beneficial owners {totalOwnership > 0 ? `(${totalOwnership.toFixed(2)}% declared)` : null}
          </legend>
          {owners.map((owner, index) => (
            <div className="grid gap-3 rounded-lg border border-border-strong bg-surface-muted p-4 sm:grid-cols-[2fr_1fr_1fr_auto]" key={index}>
              <Field label="Full name" name={`owner-${index}-name`}>
                {(wiring) => (
                  <Input
                    disabled={!editable}
                    maxLength={200}
                    onChange={(event) => setOwners((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, fullName: event.target.value } : item
                    )))}
                    value={owner.fullName}
                    {...wiring}
                  />
                )}
              </Field>
              <Field label="Ownership %" name={`owner-${index}-percentage`}>
                {(wiring) => (
                  <Input
                    disabled={!editable}
                    inputMode="decimal"
                    onChange={(event) => setOwners((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, ownershipPercentage: event.target.value } : item
                    )))}
                    pattern="\d{1,3}(\.\d{1,2})?"
                    value={owner.ownershipPercentage}
                    {...wiring}
                  />
                )}
              </Field>
              <Field label="Nationality" name={`owner-${index}-nationality`}>
                {(wiring) => (
                  <Input
                    disabled={!editable}
                    maxLength={80}
                    onChange={(event) => setOwners((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, nationality: event.target.value } : item
                    )))}
                    value={owner.nationality ?? ''}
                    {...wiring}
                  />
                )}
              </Field>
              <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-stretch">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={owner.isPep}
                    disabled={!editable}
                    onChange={(event) => setOwners((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, isPep: event.target.checked } : item
                    )))}
                    type="checkbox"
                  />
                  PEP
                </label>
                {editable ? (
                  <button
                    aria-label="Remove owner"
                    className="text-danger-strong"
                    onClick={() => setOwners((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {editable ? (
            <Button
              onClick={() => setOwners((current) => [...current, emptyOwner()])}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Plus aria-hidden="true" size={16} /> Add beneficial owner
            </Button>
          ) : null}
        </fieldset>

        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

        {editable ? (
          <Button disabled={pending} fullWidth size="lg" type="submit">
            {pending ? 'Saving…' : 'Save profile'}
            {!pending ? <ArrowRight aria-hidden="true" size={18} /> : null}
          </Button>
        ) : null}
      </form>
    </div>
  );
}

function InvestorProfileSection({ onboardingCase }: { onboardingCase: PortalCase }) {
  const editable = editableStatuses.has(onboardingCase.status);
  const [loaded, setLoaded] = useState<InvestorProfile | null | undefined>(undefined);
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('');
  const [governmentIdType, setGovernmentIdType] = useState('');
  const [governmentIdNumber, setGovernmentIdNumber] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [occupation, setOccupation] = useState('');
  const [sourceOfFunds, setSourceOfFunds] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadInvestorProfile(onboardingCase.id).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setMessage({ tone: 'danger', text: result.message });
        setLoaded(null);
        return;
      }
      setLoaded(result.profile);
      if (result.profile) {
        setFullName(result.profile.fullName);
        setDateOfBirth(result.profile.dateOfBirth ?? '');
        setNationality(result.profile.nationality ?? '');
        setGovernmentIdType(result.profile.governmentIdType ?? '');
        setGovernmentIdNumber(result.profile.governmentIdNumber ?? '');
        setResidentialAddress(result.profile.residentialAddress ?? '');
        setPhoneNumber(result.profile.phoneNumber ?? '');
        setOccupation(result.profile.occupation ?? '');
        setSourceOfFunds(result.profile.sourceOfFunds ?? '');
        setVersion(result.profile.version);
      }
    });
    return () => {
      active = false;
    };
  }, [onboardingCase.id]);

  async function submit() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    const input: InvestorProfileInput = {
      expectedVersion: version,
      fullName: fullName.trim(),
      dateOfBirth: dateOfBirth || undefined,
      nationality: nationality.trim() || undefined,
      governmentIdType: governmentIdType.trim() || undefined,
      governmentIdNumber: governmentIdNumber.trim() || undefined,
      residentialAddress: residentialAddress.trim() || undefined,
      phoneNumber: phoneNumber.trim() || undefined,
      occupation: occupation.trim() || undefined,
      sourceOfFunds: sourceOfFunds.trim() || undefined,
    };
    const result = await saveInvestorProfile(onboardingCase.id, input, fetch);
    if (result.ok) {
      setVersion(result.profile.version);
      setMessage({ tone: 'success', text: 'Your investor profile has been saved.' });
    } else {
      setMessage({ tone: 'danger', text: result.message });
    }
    setPending(false);
  }

  if (loaded === undefined) {
    return <p className="text-muted-foreground">Loading your investor profile…</p>;
  }

  return (
    <div className="max-w-2xl">
      <PageHeading
        eyebrow="Investor profile"
        title="Your investor details"
        description={editable
          ? 'This information is reviewed by our compliance team before your case can move forward.'
          : 'Editing is unavailable while this case is in its current state.'}
      />
      <form
        className="mt-8 grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Full legal name" name="fullName">
          {(wiring) => (
            <Input
              disabled={!editable}
              maxLength={300}
              onChange={(event) => setFullName(event.target.value)}
              required
              value={fullName}
              {...wiring}
            />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Date of birth" name="dateOfBirth">
            {(wiring) => (
              <Input
                disabled={!editable}
                onChange={(event) => setDateOfBirth(event.target.value)}
                type="date"
                value={dateOfBirth}
                {...wiring}
              />
            )}
          </Field>
          <Field label="Nationality" name="nationality">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={80}
                onChange={(event) => setNationality(event.target.value)}
                value={nationality}
                {...wiring}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Government ID type" name="governmentIdType">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={100}
                onChange={(event) => setGovernmentIdType(event.target.value)}
                placeholder="e.g. Passport, UMID"
                value={governmentIdType}
                {...wiring}
              />
            )}
          </Field>
          <Field label="Government ID number" name="governmentIdNumber">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={60}
                onChange={(event) => setGovernmentIdNumber(event.target.value)}
                value={governmentIdNumber}
                {...wiring}
              />
            )}
          </Field>
        </div>
        <Field label="Residential address" name="residentialAddress">
          {(wiring) => (
            <Textarea
              disabled={!editable}
              maxLength={500}
              onChange={(event) => setResidentialAddress(event.target.value)}
              value={residentialAddress}
              {...wiring}
            />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Phone number" name="phoneNumber">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={30}
                onChange={(event) => setPhoneNumber(event.target.value)}
                value={phoneNumber}
                {...wiring}
              />
            )}
          </Field>
          <Field label="Occupation" name="occupation">
            {(wiring) => (
              <Input
                disabled={!editable}
                maxLength={200}
                onChange={(event) => setOccupation(event.target.value)}
                value={occupation}
                {...wiring}
              />
            )}
          </Field>
        </div>
        <Field
          description="A brief, plain-language description of where your investable funds come from."
          label="Source of funds"
          name="sourceOfFunds"
        >
          {(wiring) => (
            <Textarea
              disabled={!editable}
              maxLength={500}
              onChange={(event) => setSourceOfFunds(event.target.value)}
              value={sourceOfFunds}
              {...wiring}
            />
          )}
        </Field>

        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

        {editable ? (
          <Button disabled={pending} fullWidth size="lg" type="submit">
            {pending ? 'Saving…' : 'Save profile'}
            {!pending ? <ArrowRight aria-hidden="true" size={18} /> : null}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
