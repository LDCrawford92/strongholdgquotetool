"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  FileSpreadsheet,
  Grid2X2,
  History,
  Info,
  LogOut,
  Menu,
  Package,
  Printer,
  RotateCcw,
  Ruler,
  Save,
  ScrollText,
  Settings,
  Sparkles,
  Trash2,
  Truck,
  User,
  Wrench,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { matrices } from "@/lib/pricing/data";
import {
  displayValuesFromMetres,
  lenientMetres,
  parseDecimal,
  quote,
} from "@/lib/pricing/engine";
import {
  formatCurrency,
  formatMeasurement,
  formatMetres,
} from "@/lib/pricing/format";
import {
  type AddOnSelection,
  type MeasurementEntry,
  type MeasurementUnit,
  type PriceMatrix,
  type QuoteResult,
  measurementUnits,
  priceListTypes,
} from "@/lib/pricing/types";
import { isSupabaseConfigured, supabase, usernameToEmail } from "@/lib/supabase/client";

type AddOnKey = keyof AddOnSelection;
type AppSection = "curtains" | "coil-carriers" | "price-sheets" | "history" | "settings";

type PriceSheetRecord = {
  id: string;
  sheet_key: string;
  sheet_name: string;
  sheet_data: PriceMatrix;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type SavedQuoteRow = {
  id: string;
  user_id: string;
  customer_name: string;
  quote_reference: string;
  quote_data: QuoteResult;
  total_price: number;
  created_at: string;
  expires_at: string;
};

const emptyAddOns: AddOnSelection = {
  print: false,
  conspicuityTape: false,
  fitting: false,
  delivery: false,
};

const addOns: Array<{
  key: AddOnKey;
  title: string;
  description: string;
  icon: typeof Printer;
}> = [
  {
    key: "print",
    title: "Print",
    description: "Calculated from the print area.",
    icon: Printer,
  },
  {
    key: "conspicuityTape",
    title: "Sticky Tape",
    description: "Adds the standard sticky tape charge.",
    icon: Sparkles,
  },
  {
    key: "fitting",
    title: "Fitting",
    description: "Includes the standard fitting cost.",
    icon: Wrench,
  },
  {
    key: "delivery",
    title: "Delivery Cost",
    description: "Adds the delivery charge to the quote.",
    icon: Truck,
  },
];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(isSupabaseConfigured);
  const [activeSection, setActiveSection] = useState<AppSection>("curtains");
  const [priceSheets, setPriceSheets] = useState<PriceSheetRecord[]>([]);
  const [isLoadingPriceSheets, setIsLoadingPriceSheets] = useState(false);
  const [priceSheetsError, setPriceSheetsError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setIsCheckingSession(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setActiveSection("curtains");
      setIsCheckingSession(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    setSession(null);
    setActiveSection("curtains");
  }

  async function loadPriceSheets(currentSession: Session) {
    setIsLoadingPriceSheets(true);
    setPriceSheetsError("");

    const { data, error } = await supabase
      .from("price_sheets")
      .select("id,sheet_key,sheet_name,sheet_data,is_active,updated_by,updated_at,created_at")
      .order("sheet_name", { ascending: true });

    if (error) {
      setIsLoadingPriceSheets(false);
      setPriceSheets([]);
      setPriceSheetsError(error.message);
      return;
    }

    if (!data?.length) {
      const now = new Date().toISOString();
      const defaults = priceListTypes.map((sheetName) => ({
        sheet_key: slugify(String(sheetName)),
        sheet_name: String(sheetName),
        sheet_data: cloneMatrix(matrices[sheetName]),
        is_active: true,
        updated_by: currentSession.user.id,
        updated_at: now,
      }));

      const { data: insertedData, error: insertError } = await supabase
        .from("price_sheets")
        .insert(defaults)
        .select("id,sheet_key,sheet_name,sheet_data,is_active,updated_by,updated_at,created_at")
        .order("sheet_name", { ascending: true });

      setIsLoadingPriceSheets(false);

      if (insertError) {
        setPriceSheets([]);
        setPriceSheetsError(insertError.message);
        return;
      }

      setPriceSheets((insertedData ?? []).map(normalizePriceSheet).filter((sheet): sheet is PriceSheetRecord => sheet !== null));
      return;
    }

    setPriceSheets(data.map(normalizePriceSheet).filter((sheet): sheet is PriceSheetRecord => sheet !== null));
    setIsLoadingPriceSheets(false);
  }

  useEffect(() => {
    if (!session) return;
    void Promise.resolve().then(() => loadPriceSheets(session));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  if (isCheckingSession) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="panel w-full max-w-md text-center">
          <Image src="/stronghold-logo.png" alt="Stronghold" width={220} height={110} priority className="mx-auto h-auto w-44" />
          <p className="mt-5 text-sm font-semibold text-slate-500">Checking your session...</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-6 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="panel space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <Image src="/stronghold-logo.png" alt="Stronghold" width={260} height={130} priority className="h-auto w-40 sm:w-44" />
              <div>
                <h1 className="text-2xl font-bold tracking-normal text-ink sm:text-3xl">Stronghold Pricing</h1>
                <p className="mt-1 text-sm font-medium text-slate-500">Curtains & Coil Carrier Covers</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
              <div className="min-h-11 rounded-[16px] border border-line bg-mist px-4 py-3 text-center text-sm font-semibold text-ink sm:text-left">
                {displayUsername(session.user.email)}
              </div>
              <button type="button" onClick={logout} className="secondary-button flex min-h-11 items-center justify-center gap-2 rounded-[16px] px-4">
                <LogOut size={17} />
                Logout
              </button>
            </div>
          </div>

          <nav className="grid rounded-[22px] border border-line bg-mist p-1.5 shadow-inner sm:grid-cols-2 lg:grid-cols-5" aria-label="Main menu">
            <MenuButton section="curtains" activeSection={activeSection} onClick={setActiveSection} icon={ScrollText} label="Curtains" />
            <MenuButton section="coil-carriers" activeSection={activeSection} onClick={setActiveSection} icon={Package} label="Coil Carriers" />
            <MenuButton section="price-sheets" activeSection={activeSection} onClick={setActiveSection} icon={FileSpreadsheet} label="Pricing Sheets" />
            <MenuButton section="history" activeSection={activeSection} onClick={setActiveSection} icon={History} label="History" />
            <MenuButton section="settings" activeSection={activeSection} onClick={setActiveSection} icon={Settings} label="Settings" />
          </nav>
        </header>

        {activeSection === "curtains" ? (
          <CurtainsTool
            priceSheets={priceSheets}
            priceSheetsError={priceSheetsError}
            isLoadingPriceSheets={isLoadingPriceSheets}
            session={session}
          />
        ) : null}
        {activeSection === "coil-carriers" ? <CoilCarriersTool /> : null}
        {activeSection === "price-sheets" ? (
          <PriceSheetsTool
            priceSheets={priceSheets}
            onPriceSheetsChange={setPriceSheets}
            onReload={() => loadPriceSheets(session)}
            isLoading={isLoadingPriceSheets}
            loadError={priceSheetsError}
            session={session}
          />
        ) : null}
        {activeSection === "history" ? <HistoryTool session={session} /> : null}
        {activeSection === "settings" ? <SettingsTool session={session} /> : null}
      </div>
    </main>
  );
}

function CurtainsTool({
  priceSheets,
  priceSheetsError,
  isLoadingPriceSheets,
  session,
}: {
  priceSheets: PriceSheetRecord[];
  priceSheetsError: string;
  isLoadingPriceSheets: boolean;
  session: Session;
}) {
  const activePriceSheets = useMemo(() => priceSheets.filter((sheet) => sheet.is_active), [priceSheets]);
  const [selectedPriceSheetId, setSelectedPriceSheetId] = useState("");
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("Metres");
  const [poleCentrePrimary, setPoleCentrePrimary] = useState("");
  const [poleCentreSecondary, setPoleCentreSecondary] = useState("");
  const [dropPrimary, setDropPrimary] = useState("");
  const [dropSecondary, setDropSecondary] = useState("");
  const [addOnSelection, setAddOnSelection] = useState<AddOnSelection>(emptyAddOns);
  const [expandedAddOns, setExpandedAddOns] = useState<Set<AddOnKey>>(new Set());
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveModalQuote, setSaveModalQuote] = useState<QuoteResult | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  const canClear = useMemo(
    () =>
      Boolean(
        selectedPriceSheetId ||
          measurementUnit !== "Metres" ||
          poleCentrePrimary ||
          poleCentreSecondary ||
          dropPrimary ||
          dropSecondary ||
          Object.values(addOnSelection).some(Boolean) ||
          result ||
          errorMessage,
      ),
    [
      selectedPriceSheetId,
      measurementUnit,
      poleCentrePrimary,
      poleCentreSecondary,
      dropPrimary,
      dropSecondary,
      addOnSelection,
      result,
      errorMessage,
    ],
  );

  function clearFeedback() {
    setResult(null);
    setErrorMessage("");
    setSuccessMessage("");
  }

  function updateUnit(nextUnit: MeasurementUnit) {
    if (nextUnit === measurementUnit) return;

    const poleMetres = lenientMetres(poleCentrePrimary, poleCentreSecondary, measurementUnit);
    const dropMetres = lenientMetres(dropPrimary, dropSecondary, measurementUnit);
    const nextPole = poleMetres ? displayValuesFromMetres(poleMetres, nextUnit) : { primary: "", secondary: "" };
    const nextDrop = dropMetres ? displayValuesFromMetres(dropMetres, nextUnit) : { primary: "", secondary: "" };

    setMeasurementUnit(nextUnit);
    setPoleCentrePrimary(nextPole.primary);
    setPoleCentreSecondary(nextPole.secondary);
    setDropPrimary(nextDrop.primary);
    setDropSecondary(nextDrop.secondary);
    clearFeedback();
  }

  function getQuote() {
    try {
      if (!selectedPriceSheetId) {
        throw new Error("Please select a pricing model.");
      }

      if (priceSheetsError) {
        throw new Error(`Price sheets could not be loaded: ${priceSheetsError}`);
      }

      const selectedSheet = activePriceSheets.find((sheet) => sheet.id === selectedPriceSheetId);
      if (!selectedSheet) {
        throw new Error("Please select an active pricing sheet.");
      }

      const poleCentre = parseMeasurement(
        poleCentrePrimary,
        poleCentreSecondary,
        "pole centre",
        measurementUnit,
      );
      const drop = parseMeasurement(dropPrimary, dropSecondary, "drop", measurementUnit);

      setResult(
        quote({
          priceListType: selectedSheet.sheet_name,
          measurementUnit,
          poleCentre,
          drop,
          addOns: addOnSelection,
        }, { [selectedSheet.sheet_name]: selectedSheet.sheet_data }),
      );
      setErrorMessage("");
      setSuccessMessage("");
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    }
  }

  function clear() {
    setSelectedPriceSheetId("");
    setMeasurementUnit("Metres");
    setPoleCentrePrimary("");
    setPoleCentreSecondary("");
    setDropPrimary("");
    setDropSecondary("");
    setAddOnSelection(emptyAddOns);
    setExpandedAddOns(new Set());
    setResult(null);
    setErrorMessage("");
    setSuccessMessage("");
    setSaveModalQuote(null);
  }

  function toggleAddOn(addOn: AddOnKey) {
    setAddOnSelection((current) => ({ ...current, [addOn]: !current[addOn] }));
    clearFeedback();
  }

  function toggleExpanded(addOn: AddOnKey) {
    setExpandedAddOns((current) => {
      const next = new Set(current);
      if (next.has(addOn)) next.delete(addOn);
      else next.add(addOn);
      return next;
    });
  }

  return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,0.65fr)]" data-quote-owner-user-id={session.user.id}>
        <section className="space-y-5">
          <section className="panel">
            <SectionTitle title="Select Pricing" />
            {priceSheetsError ? <div className="mt-4"><StatusBanner message={`Price sheets could not be loaded: ${priceSheetsError}`} tone="error" /></div> : null}
            <label className="field mt-4 flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent-deep to-accent text-white">
                <Grid2X2 size={18} />
              </span>
              <select
                value={selectedPriceSheetId}
                disabled={isLoadingPriceSheets || Boolean(priceSheetsError)}
                onChange={(event) => {
                  setSelectedPriceSheetId(event.target.value);
                  clearFeedback();
                }}
                className="h-14 flex-1 appearance-none bg-transparent text-sm font-semibold text-ink outline-none"
                aria-label="Select pricing"
              >
                <option value="">{isLoadingPriceSheets ? "Loading price sheets..." : "Select pricing"}</option>
                {activePriceSheets.map((priceSheet) => (
                  <option key={priceSheet.id} value={priceSheet.id}>
                    {priceSheet.sheet_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-slate-400" size={18} />
            </label>
          </section>

          <section className="panel">
            <SectionTitle title="Measurements" subtitle="Approximate measurements" />

            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-500">Units</p>
                <div className="grid grid-cols-3 gap-2 rounded-[20px] border border-line bg-mist p-1.5">
                  {measurementUnits.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => updateUnit(unit)}
                      className={clsx(
                        "min-h-11 rounded-2xl px-2 text-xs font-semibold transition sm:text-sm",
                        unit === measurementUnit
                          ? "bg-gradient-to-br from-accent-deep to-accent text-white shadow-control"
                          : "text-ink hover:bg-white",
                      )}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              {measurementUnit === "Feet & Inches" ? (
                <div className="space-y-3">
                  <CompoundMeasurementField
                    title="Pole Centre"
                    primary={poleCentrePrimary}
                    secondary={poleCentreSecondary}
                    onPrimaryChange={(value) => {
                      setPoleCentrePrimary(value);
                      clearFeedback();
                    }}
                    onSecondaryChange={(value) => {
                      setPoleCentreSecondary(value);
                      clearFeedback();
                    }}
                  />
                  <CompoundMeasurementField
                    title="Drop"
                    primary={dropPrimary}
                    secondary={dropSecondary}
                    onPrimaryChange={(value) => {
                      setDropPrimary(value);
                      clearFeedback();
                    }}
                    onSecondaryChange={(value) => {
                      setDropSecondary(value);
                      clearFeedback();
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <MeasurementField
                    title="Pole Centre"
                    placeholder={measurementUnit === "Metres" ? "e.g. 8.4" : "e.g. 8400"}
                    suffix={measurementUnit === "Metres" ? "m" : "mm"}
                    value={poleCentrePrimary}
                    onChange={(value) => {
                      setPoleCentrePrimary(value);
                      clearFeedback();
                    }}
                  />
                  <MeasurementField
                    title="Drop"
                    placeholder={measurementUnit === "Metres" ? "e.g. 3.0" : "e.g. 3000"}
                    suffix={measurementUnit === "Metres" ? "m" : "mm"}
                    value={dropPrimary}
                    onChange={(value) => {
                      setDropPrimary(value);
                      clearFeedback();
                    }}
                  />
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <SectionTitle title="Add-Ons" />
            <div className="mt-4 space-y-3">
              {addOns.map((addOn) => (
                <AddOnRow
                  key={addOn.key}
                  addOn={addOn}
                  selected={addOnSelection[addOn.key]}
                  expanded={expandedAddOns.has(addOn.key)}
                  onToggle={() => toggleAddOn(addOn.key)}
                  onExpand={() => toggleExpanded(addOn.key)}
                />
              ))}
            </div>
          </section>

          {errorMessage ? (
            <div className="flex gap-3 rounded-[20px] border border-red-200 bg-red-50 p-4 text-sm font-medium text-ink">
              <Info className="mt-0.5 shrink-0 text-red-600" size={20} />
              <span>{errorMessage}</span>
            </div>
          ) : null}
          {successMessage ? <StatusBanner message={successMessage} tone="success" /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button className="primary-button" type="button" onClick={getQuote}>
              Get Quote
            </button>
            <button className="secondary-button flex items-center justify-center gap-2" type="button" onClick={clear} disabled={!canClear}>
              <RotateCcw size={17} />
              Clear
            </button>
          </div>
        </section>

        <aside className="lg:sticky lg:top-8 lg:h-fit">
          {result ? (
            <ResultCard
              quoteResult={result}
              onDiscard={() => {
                setResult(null);
                setSaveModalQuote(null);
              }}
              onSave={() => setSaveModalQuote(result)}
            />
          ) : (
            <div className="panel flex min-h-[420px] flex-col justify-between overflow-hidden">
              <div>
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Ruler />
                </span>
                <h2 className="mt-5 text-2xl font-bold text-ink">Quote Result</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                  Select a pricing list, enter measurements, choose any add-ons, then generate the final total.
                </p>
              </div>
              <div className="rounded-[24px] border border-line bg-mist p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Matrix bounds</p>
                <p className="mt-2 text-sm font-semibold text-ink">Quotes round up to the next available pole centre and drop.</p>
              </div>
            </div>
          )}
        </aside>
        {saveModalQuote ? (
          <SaveQuoteModal
            quoteResult={saveModalQuote}
            session={session}
            onClose={() => setSaveModalQuote(null)}
            onSaved={() => {
              setSaveModalQuote(null);
              setResult(null);
              setSuccessMessage("Quote saved successfully.");
            }}
          />
        ) : null}
      </div>
  );
}

function parseMeasurement(primaryText: string, secondaryText: string, label: string, unit: MeasurementUnit): MeasurementEntry {
  if (unit === "Metres" || unit === "Millimetres") {
    const trimmed = primaryText.trim();
    if (!trimmed) throw new Error(`Enter a ${label} in ${unit.toLowerCase()}.`);

    const value = parseDecimal(trimmed);
    if (value === null) throw new Error(`Enter a valid ${label} in ${unit.toLowerCase()}.`);
    if (value <= 0) throw new Error(`${capitalize(label)} must be greater than zero.`);

    return { kind: "decimal", value };
  }

  const feetText = primaryText.trim();
  const inchesText = secondaryText.trim();
  if (!feetText && !inchesText) throw new Error(`Enter a ${label} in feet and inches.`);

  const feet = feetText ? Number(feetText) : 0;
  if (!Number.isInteger(feet) || feet < 0) throw new Error(`Enter whole feet for ${label}.`);

  const inches = inchesText ? parseDecimal(inchesText) : 0;
  if (inches === null || inches < 0) throw new Error(`Enter valid inches for ${label}.`);
  if (feet <= 0 && inches <= 0) throw new Error(`${capitalize(label)} must be greater than zero.`);

  return { kind: "feet_and_inches", feet, inches };
}

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isSupabaseConfigured) {
      setErrorMessage("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername) {
      setErrorMessage("Enter your username.");
      return;
    }

    if (!password) {
      setErrorMessage("Enter your password.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(normalizedUsername),
      password,
    });

    setIsLoading(false);

    if (error || !data.session) {
      setErrorMessage(error?.message ?? "Unable to sign in. Check your username and password.");
      return;
    }

    onLogin(data.session);
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <form onSubmit={login} className="panel w-full max-w-md">
        <div className="text-center">
          <Image src="/stronghold-logo.png" alt="Stronghold" width={240} height={120} priority className="mx-auto h-auto w-48" />
          <h1 className="mt-5 text-3xl font-bold text-ink">Sign in</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">Use your Stronghold username and password.</p>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Username</span>
            <span className="field flex items-center gap-3">
              <User className="shrink-0 text-accent" size={18} />
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setErrorMessage("");
                }}
                autoCapitalize="none"
                autoComplete="username"
                placeholder="lewis"
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Password</span>
            <span className="field flex items-center gap-3">
              <Settings className="shrink-0 text-accent" size={18} />
              <input
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrorMessage("");
                }}
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
              />
            </span>
          </label>

          {!isSupabaseConfigured ? (
            <StatusBanner message="Supabase environment variables are missing." tone="error" />
          ) : null}
          {errorMessage ? <StatusBanner message={errorMessage} tone="error" /> : null}

          <button type="submit" className="primary-button w-full" disabled={isLoading || !isSupabaseConfigured}>
            {isLoading ? "Signing in..." : "Login"}
          </button>
        </div>
      </form>
    </main>
  );
}

function SaveQuoteModal({
  quoteResult,
  session,
  onClose,
  onSaved,
}: {
  quoteResult: QuoteResult;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [quoteReference, setQuoteReference] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function saveQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCustomerName = customerName.trim();
    const trimmedReference = quoteReference.trim();

    if (!trimmedCustomerName) {
      setErrorMessage("Enter a customer name.");
      return;
    }

    if (!trimmedReference) {
      setErrorMessage("Enter a quote reference.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("saved_quotes").insert({
      user_id: session.user.id,
      customer_name: trimmedCustomerName,
      quote_reference: trimmedReference,
      quote_data: quoteResult,
      total_price: quoteResult.totalPrice,
      expires_at: expiresAt,
    });

    setIsSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4 py-6 backdrop-blur-sm">
      <form onSubmit={saveQuote} className="panel max-h-[92vh] w-full max-w-xl overflow-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">Save Quote</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Add customer details before saving to history.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label="Close save quote">
            <X size={16} />
          </button>
        </div>

        <QuoteTotalPanel quoteResult={quoteResult} />

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Customer name</span>
            <span className="field flex items-center gap-3">
              <User className="shrink-0 text-accent" size={18} />
              <input
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setErrorMessage("");
                }}
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                placeholder="Customer name"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Quote reference</span>
            <span className="field flex items-center gap-3">
              <FileSpreadsheet className="shrink-0 text-accent" size={18} />
              <input
                value={quoteReference}
                onChange={(event) => {
                  setQuoteReference(event.target.value);
                  setErrorMessage("");
                }}
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                placeholder="Reference"
              />
            </span>
          </label>

          {errorMessage ? <StatusBanner message={errorMessage} tone="error" /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={onClose} className="secondary-button w-full" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="primary-button w-full" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Quote"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function HistoryTool({ session }: { session: Session }) {
  const [quotes, setQuotes] = useState<SavedQuoteRow[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<SavedQuoteRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    void loadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function cleanupExpiredQuotes() {
    const { error } = await supabase
      .from("saved_quotes")
      .delete()
      .eq("user_id", session.user.id)
      .lt("expires_at", new Date().toISOString());

    if (error) {
      setMessage({ tone: "error", text: error.message });
    }
  }

  async function loadQuotes() {
    setIsLoading(true);
    setMessage(null);

    await cleanupExpiredQuotes();

    const { data, error } = await supabase
      .from("saved_quotes")
      .select("id,user_id,customer_name,quote_reference,quote_data,total_price,created_at,expires_at")
      .eq("user_id", session.user.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    setIsLoading(false);

    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }

    setQuotes((data ?? []).map(normalizeSavedQuote).filter((quoteRow): quoteRow is SavedQuoteRow => quoteRow !== null));
  }

  async function deleteQuote(quoteId: string) {
    const confirmed = window.confirm("Delete this saved quote?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("saved_quotes")
      .delete()
      .eq("id", quoteId)
      .eq("user_id", session.user.id);

    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }

    setSelectedQuote(null);
    setMessage({ tone: "success", text: "Quote deleted." });
    await loadQuotes();
  }

  return (
    <section className="space-y-5">
      <div className="panel flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <SectionTitle title="History" subtitle="Saved quotes for the logged-in user." />
          <p className="mt-3 text-sm font-medium text-slate-500">Expired quotes are hidden and cleaned up when this page loads.</p>
        </div>
        <button type="button" onClick={loadQuotes} className="secondary-button flex items-center justify-center gap-2">
          <RotateCcw size={17} />
          Refresh
        </button>
      </div>

      {message ? <StatusBanner message={message.text} tone={message.tone} /> : null}

      <div className="grid gap-4">
        {isLoading ? (
          <div className="panel text-sm font-semibold text-slate-500">Loading saved quotes...</div>
        ) : null}

        {!isLoading && quotes.length === 0 ? (
          <div className="panel text-sm font-semibold text-slate-500">No saved quotes found.</div>
        ) : null}

        {quotes.map((savedQuote) => (
          <article key={savedQuote.id} className="panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-lg font-bold text-ink">{savedQuote.customer_name}</p>
                <p className="mt-1 text-sm font-semibold text-accent">Ref {savedQuote.quote_reference}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[480px]">
                <DetailTile label="Total" value={formatCurrency(savedQuote.total_price)} />
                <DetailTile label="Created" value={formatDate(savedQuote.created_at)} />
                <DetailTile label="Expires" value={formatDate(savedQuote.expires_at)} />
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setSelectedQuote(savedQuote)} className="primary-button flex items-center justify-center gap-2">
                <Eye size={17} />
                View Details
              </button>
              <button type="button" onClick={() => deleteQuote(savedQuote.id)} className="secondary-button flex items-center justify-center gap-2">
                <Trash2 size={17} />
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {selectedQuote ? (
        <SavedQuoteDetailsModal savedQuote={selectedQuote} onClose={() => setSelectedQuote(null)} onDelete={() => deleteQuote(selectedQuote.id)} />
      ) : null}
    </section>
  );
}

function SavedQuoteDetailsModal({
  savedQuote,
  onClose,
  onDelete,
}: {
  savedQuote: SavedQuoteRow;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4 py-6 backdrop-blur-sm">
      <div className="panel max-h-[92vh] w-full max-w-2xl overflow-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">{savedQuote.customer_name}</h2>
            <p className="mt-1 text-sm font-semibold text-accent">Ref {savedQuote.quote_reference}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label="Close saved quote details">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <DetailTile label="Created" value={formatDate(savedQuote.created_at)} />
          <DetailTile label="Expires" value={formatDate(savedQuote.expires_at)} />
        </div>

        <QuoteTotalPanel quoteResult={savedQuote.quote_data} />
        <div className="mt-4 rounded-[20px] border border-line bg-white p-4">
          <p className="text-sm font-semibold text-ink">Quote Breakdown</p>
          <QuoteBreakdown quoteResult={savedQuote.quote_data} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="secondary-button w-full">
            Close
          </button>
          <button type="button" onClick={onDelete} className="secondary-button flex w-full items-center justify-center gap-2">
            <Trash2 size={17} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsTool({ session }: { session: Session }) {
  const fallbackUsername = session.user.email?.replace("@stronghold.local", "") ?? "";
  const [username, setUsername] = useState(fallbackUsername);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase
      .from("profiles")
      .select("username")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!mounted) return;
        if (data?.username) setUsername(data.username);
      });

    return () => {
      mounted = false;
    };
  }, [session.user.id]);

  async function changeUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUsername = username.trim().toLowerCase();

    if (!nextUsername) {
      setUsernameStatus({ tone: "error", message: "Username cannot be empty." });
      return;
    }

    setIsSavingUsername(true);
    setUsernameStatus(null);

    const { data, error } = await supabase
      .from("profiles")
      .update({ username: nextUsername })
      .eq("id", session.user.id)
      .select("username");

    setIsSavingUsername(false);

    if (error) {
      setUsernameStatus({ tone: "error", message: error.message });
      return;
    }

    if (!data?.length) {
      setUsernameStatus({ tone: "error", message: "No profile row was found for this user." });
      return;
    }

    setUsername(nextUsername);
    setUsernameStatus({ tone: "success", message: "Username updated." });
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newPassword || !confirmPassword) {
      setPasswordStatus({ tone: "error", message: "Enter and confirm your new password." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordStatus({ tone: "error", message: "Passwords do not match." });
      return;
    }

    setIsSavingPassword(true);
    setPasswordStatus(null);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    setIsSavingPassword(false);

    if (error) {
      setPasswordStatus({ tone: "error", message: error.message });
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setPasswordStatus({ tone: "success", message: "Password updated." });
  }

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={changeUsername} className="panel">
        <SectionTitle title="Username" subtitle="Update the display username stored in public.profiles." />
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-500">Username</span>
            <span className="field flex items-center gap-3">
              <User className="shrink-0 text-accent" size={18} />
              <input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setUsernameStatus(null);
                }}
                autoCapitalize="none"
                autoComplete="username"
                className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
              />
            </span>
          </label>

          <div className="rounded-[20px] border border-line bg-mist p-4 text-sm font-medium text-slate-500">
            Login email is managed internally as `{username || "username"}@stronghold.local` and cannot be changed here.
          </div>

          {usernameStatus ? <StatusBanner message={usernameStatus.message} tone={usernameStatus.tone} /> : null}

          <button type="submit" className="primary-button w-full" disabled={isSavingUsername}>
            {isSavingUsername ? "Saving..." : "Save Username"}
          </button>
        </div>
      </form>

      <form onSubmit={changePassword} className="panel">
        <SectionTitle title="Password" subtitle="Change the password for the current Supabase Auth user." />
        <div className="mt-5 space-y-4">
          <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField label="Confirm Password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

          {passwordStatus ? <StatusBanner message={passwordStatus.message} tone={passwordStatus.tone} /> : null}

          <button type="submit" className="primary-button w-full" disabled={isSavingPassword}>
            {isSavingPassword ? "Updating..." : "Update Password"}
          </button>
        </div>
      </form>

      <div className="panel lg:col-span-2">
        <SectionTitle title="Session" subtitle="Prepared for future saved quote ownership." />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <DetailTile label="Supabase user id" value={session.user.id} />
          <DetailTile label="Login identity" value={session.user.email ?? "Not available"} />
        </div>
      </div>
    </section>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-500">{label}</span>
      <span className="field flex items-center gap-3">
        <Settings className="shrink-0 text-accent" size={18} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type="password"
          autoComplete={autoComplete}
          className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
        />
      </span>
    </label>
  );
}

function StatusBanner({ message, tone }: { message: string; tone: "success" | "error" }) {
  return (
    <div
      className={clsx(
        "flex gap-3 rounded-[20px] border p-4 text-sm font-medium text-ink",
        tone === "success" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
      )}
    >
      <Info className={clsx("mt-0.5 shrink-0", tone === "success" ? "text-emerald-600" : "text-red-600")} size={20} />
      <span>{message}</span>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-line bg-mist p-4">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-2 break-all text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function MenuButton({
  section,
  activeSection,
  onClick,
  icon: Icon,
  label,
}: {
  section: AppSection;
  activeSection: AppSection;
  onClick: (section: AppSection) => void;
  icon: typeof Menu;
  label: string;
}) {
  const selected = section === activeSection;

  return (
    <button
      type="button"
      onClick={() => onClick(section)}
      className={clsx(
        "flex min-h-12 items-center justify-center gap-2 rounded-[17px] px-3 text-sm font-semibold transition sm:px-4",
        selected
          ? "bg-gradient-to-br from-accent-deep to-accent text-white shadow-control"
          : "text-ink hover:bg-white",
      )}
    >
      <Icon className="shrink-0" size={18} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function CoilCarriersTool() {
  return (
    <section className="panel min-h-[460px]">
      <div className="flex max-w-2xl flex-col gap-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Package />
        </span>
        <div>
          <h2 className="text-2xl font-bold text-ink">Coil Carriers</h2>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
            This section is ready for the coil carrier quote flow. Add the relevant Swift pricing files or workbook data and it can use the same editable price-sheet pattern as Curtains.
          </p>
        </div>
      </div>
    </section>
  );
}

function PriceSheetsTool({
  priceSheets,
  onPriceSheetsChange,
  onReload,
  isLoading,
  loadError,
  session,
}: {
  priceSheets: PriceSheetRecord[];
  onPriceSheetsChange: Dispatch<SetStateAction<PriceSheetRecord[]>>;
  onReload: () => Promise<void>;
  isLoading: boolean;
  loadError: string;
  session: Session;
}) {
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [draftState, setDraftState] = useState<{ sheetId: string; matrix: PriceMatrix } | null>(null);
  const [isEditingUnlocked, setIsEditingUnlocked] = useState(false);
  const [editPassword, setEditPassword] = useState("");
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const effectiveSelectedSheetId = selectedSheetId || priceSheets[0]?.id || "";
  const selectedSheet = priceSheets.find((sheet) => sheet.id === effectiveSelectedSheetId) ?? null;
  const draftMatrix = draftState?.sheetId === effectiveSelectedSheetId ? draftState.matrix : null;
  const matrix = draftMatrix ?? selectedSheet?.sheet_data ?? null;

  function unlockEditing() {
    if (editPassword !== "stronghold1") {
      setStatus({ tone: "error", message: "Incorrect editing password." });
      return;
    }

    setIsEditingUnlocked(true);
    setEditPassword("");
    setStatus({ tone: "success", message: "Editing unlocked." });
  }

  function lockEditing() {
    setIsEditingUnlocked(false);
    setEditPassword("");
    setStatus(null);
  }

  function updateMatrix(updater: (matrix: PriceMatrix) => PriceMatrix) {
    if (!isEditingUnlocked) return;
    if (!selectedSheet || !matrix) return;
    setDraftState({
      sheetId: selectedSheet.id,
      matrix: updater(cloneMatrix(matrix)),
    });
  }

  function updatePrice(dropIndex: number, poleIndex: number, value: string) {
    const parsed = parseDecimal(value);
    updateMatrix((current) => ({
      ...current,
      prices: current.prices.map((row, rowIndex) =>
        rowIndex === dropIndex
          ? row.map((price, columnIndex) => (columnIndex === poleIndex ? parsed ?? 0 : price))
          : row,
      ),
    }));
  }

  function updatePoleCentre(index: number, value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null || parsed <= 0) return;

    updateMatrix((current) => ({
      ...current,
      poleCentres: current.poleCentres.map((poleCentre, poleIndex) => (poleIndex === index ? parsed : poleCentre)),
    }));
  }

  function updateDrop(index: number, value: string) {
    const parsed = parseDecimal(value);
    if (parsed === null || parsed <= 0) return;

    updateMatrix((current) => ({
      ...current,
      drops: current.drops.map((drop, dropIndex) => (dropIndex === index ? parsed : drop)),
    }));
  }

  async function savePriceSheet() {
    if (!selectedSheet || !matrix) return;

    setIsSaving(true);
    setStatus(null);
    const updatedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from("price_sheets")
      .update({
        sheet_data: matrix,
        updated_at: updatedAt,
        updated_by: session.user.id,
      })
      .eq("id", selectedSheet.id)
      .select("id,sheet_key,sheet_name,sheet_data,is_active,updated_by,updated_at,created_at")
      .single();

    setIsSaving(false);

    if (error) {
      setStatus({ tone: "error", message: error.message });
      return;
    }

    const updatedSheet = normalizePriceSheet(data);
    if (!updatedSheet) {
      setStatus({ tone: "error", message: "The saved sheet data was not in the expected format." });
      return;
    }

    onPriceSheetsChange((current) => current.map((sheet) => (sheet.id === updatedSheet.id ? updatedSheet : sheet)));
    setDraftState({ sheetId: updatedSheet.id, matrix: cloneMatrix(updatedSheet.sheet_data) });
    setStatus({ tone: "success", message: "Price sheet saved." });
  }

  return (
    <section className="space-y-5">
      <div className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionTitle
              title="Pricing Sheets"
              subtitle="Supabase-backed price matrices used by the quote generator."
            />
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-slate-500">
              Choose a price sheet and edit a draft. The live quote calculator only updates after Save Price Sheet succeeds.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
            <label className="field flex items-center gap-3">
              <FileSpreadsheet className="shrink-0 text-accent" size={19} />
              <select
                value={effectiveSelectedSheetId}
                onChange={(event) => {
                  setSelectedSheetId(event.target.value);
                  setDraftState(null);
                  setStatus(null);
                }}
                className="h-14 flex-1 appearance-none bg-transparent text-sm font-semibold text-ink outline-none"
                aria-label="Select price sheet"
                disabled={isLoading || Boolean(loadError)}
              >
                {priceSheets.map((priceSheet) => (
                  <option key={priceSheet.id} value={priceSheet.id}>
                    {priceSheet.sheet_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-slate-400" size={18} />
            </label>

            <button type="button" onClick={onReload} className="secondary-button flex items-center justify-center gap-2">
              <RotateCcw size={17} />
              Reload
            </button>
          </div>
        </div>
      </div>

      {loadError ? <StatusBanner message={`Pricing sheets could not be loaded: ${loadError}`} tone="error" /> : null}
      {status ? <StatusBanner message={status.message} tone={status.tone} /> : null}

      <div className="panel">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionTitle title="Edit Lock" subtitle="Enter the internal password to edit pricing values." />
          </div>

          {isEditingUnlocked ? (
            <button type="button" onClick={lockEditing} className="secondary-button">
              Lock Editing
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
              <label className="field flex items-center gap-3">
                <Settings className="shrink-0 text-accent" size={18} />
                <input
                  value={editPassword}
                  onChange={(event) => setEditPassword(event.target.value)}
                  type="password"
                  className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
                  placeholder="Editing password"
                />
              </label>
              <button type="button" onClick={unlockEditing} className="primary-button">
                Unlock Editing
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="panel overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4 md:px-6">
          <h2 className="text-lg font-semibold text-ink">{selectedSheet?.sheet_name ?? "Pricing Sheet"}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            {matrix ? `${matrix.drops.length} drops x ${matrix.poleCentres.length} pole centres` : "No sheet selected"}
          </p>
        </div>

        {matrix ? <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 border-b border-r border-line bg-mist px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Drop / Pole
                </th>
                {matrix.poleCentres.map((poleCentre, poleIndex) => (
                  <th key={`${selectedSheet?.id}-pole-${poleIndex}`} className="sticky top-0 z-20 border-b border-r border-line bg-mist p-2">
                    <input
                      value={poleCentre}
                      onChange={(event) => updatePoleCentre(poleIndex, event.target.value)}
                      className="w-20 rounded-xl border border-line bg-white px-2 py-2 text-center text-xs font-semibold text-ink outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      inputMode="decimal"
                      disabled={!isEditingUnlocked}
                      aria-label={`Pole centre ${poleIndex + 1}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.drops.map((drop, dropIndex) => (
                <tr key={`${selectedSheet?.id}-drop-${dropIndex}`}>
                  <th className="sticky left-0 z-10 border-b border-r border-line bg-mist p-2">
                    <input
                      value={drop}
                      onChange={(event) => updateDrop(dropIndex, event.target.value)}
                      className="w-20 rounded-xl border border-line bg-white px-2 py-2 text-center text-xs font-semibold text-ink outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      inputMode="decimal"
                      disabled={!isEditingUnlocked}
                      aria-label={`Drop ${dropIndex + 1}`}
                    />
                  </th>
                  {matrix.prices[dropIndex].map((price, poleIndex) => (
                    <td key={`${selectedSheet?.id}-${dropIndex}-${poleIndex}`} className="border-b border-r border-line bg-white p-2">
                      <input
                        value={price}
                        onChange={(event) => updatePrice(dropIndex, poleIndex, event.target.value)}
                        className="w-20 rounded-xl border border-transparent bg-white px-2 py-2 text-center font-semibold text-ink outline-none transition hover:border-line hover:bg-mist focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
                        inputMode="decimal"
                        disabled={!isEditingUnlocked}
                        aria-label={`${selectedSheet?.sheet_name ?? "Price sheet"} price drop ${drop}, pole ${matrix.poleCentres[poleIndex]}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div> : null}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={savePriceSheet} className="primary-button flex items-center justify-center gap-2" disabled={!isEditingUnlocked || !matrix || isSaving}>
          <Save size={17} />
          {isSaving ? "Saving..." : "Save Price Sheet"}
        </button>
      </div>
    </section>
  );
}

function cloneMatrix(matrix: PriceMatrix): PriceMatrix {
  return {
    poleCentres: [...matrix.poleCentres],
    drops: [...matrix.drops],
    prices: matrix.prices.map((row) => [...row]),
  };
}

function normalizePriceSheet(value: unknown): PriceSheetRecord | null {
  if (!isRecord(value) || !isPriceMatrix(value.sheet_data)) return null;

  return {
    id: String(value.id),
    sheet_key: String(value.sheet_key ?? ""),
    sheet_name: String(value.sheet_name ?? ""),
    sheet_data: cloneMatrix(value.sheet_data),
    is_active: Boolean(value.is_active),
    updated_by: typeof value.updated_by === "string" ? value.updated_by : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
    created_at: typeof value.created_at === "string" ? value.created_at : null,
  };
}

function isPriceMatrix(value: unknown): value is PriceMatrix {
  if (!isRecord(value)) return false;

  return (
    Array.isArray(value.poleCentres) &&
    value.poleCentres.every((item) => typeof item === "number") &&
    Array.isArray(value.drops) &&
    value.drops.every((item) => typeof item === "number") &&
    Array.isArray(value.prices) &&
    value.prices.every((row) => Array.isArray(row) && row.every((item) => typeof item === "number"))
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSavedQuote(value: unknown): SavedQuoteRow | null {
  if (!isRecord(value)) return null;

  const quoteData = value.quote_data;
  if (!isQuoteResult(quoteData)) return null;

  return {
    id: String(value.id),
    user_id: String(value.user_id),
    customer_name: String(value.customer_name ?? ""),
    quote_reference: String(value.quote_reference ?? ""),
    quote_data: quoteData,
    total_price: Number(value.total_price ?? quoteData.totalPrice),
    created_at: String(value.created_at ?? ""),
    expires_at: String(value.expires_at ?? ""),
  };
}

function isQuoteResult(value: unknown): value is QuoteResult {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.input) &&
    typeof value.input.priceListType === "string" &&
    typeof value.input.measurementUnit === "string" &&
    typeof value.convertedPoleCentreMetres === "number" &&
    typeof value.convertedDropMetres === "number" &&
    typeof value.roundedPoleCentre === "number" &&
    typeof value.roundedDrop === "number" &&
    typeof value.basePrice === "number" &&
    typeof value.totalPrice === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function displayUsername(email?: string) {
  const username = email?.replace("@stronghold.local", "").trim();
  if (!username) return "Signed in";

  return username.charAt(0).toUpperCase() + username.slice(1);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function MeasurementField({
  title,
  placeholder,
  suffix,
  value,
  onChange,
}: {
  title: string;
  placeholder: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-500">{title}</span>
      <span className="field flex items-center gap-3">
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-14 flex-1 bg-transparent outline-none placeholder:text-slate-300"
        />
        <span className="rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-slate-500">{suffix}</span>
      </span>
    </label>
  );
}

function CompoundMeasurementField({
  title,
  primary,
  secondary,
  onPrimaryChange,
  onSecondaryChange,
}: {
  title: string;
  primary: string;
  secondary: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-500">{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <MeasurementField title="Feet" placeholder="0" suffix="ft" value={primary} onChange={onPrimaryChange} />
        <MeasurementField title="Inches" placeholder="0" suffix="in" value={secondary} onChange={onSecondaryChange} />
      </div>
    </div>
  );
}

function AddOnRow({
  addOn,
  selected,
  expanded,
  onToggle,
  onExpand,
}: {
  addOn: (typeof addOns)[number];
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const Icon = addOn.icon;

  return (
    <div
      className={clsx(
        "rounded-[20px] border p-3 transition",
        selected ? "border-blue-200 bg-accent-soft" : "border-line bg-white",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
            selected ? "bg-gradient-to-br from-accent-deep to-accent text-white" : "bg-mist text-accent",
          )}
        >
          <Icon size={17} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{addOn.title}</p>
        <button
          type="button"
          onClick={onExpand}
          aria-label={expanded ? `Hide ${addOn.title} details` : `Show ${addOn.title} details`}
          className="grid h-8 w-8 place-items-center rounded-full bg-mist text-slate-500"
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className={clsx(
            "relative h-8 w-14 rounded-full border transition",
            selected ? "border-accent bg-accent" : "border-line bg-slate-100",
          )}
        >
          <span
            className={clsx(
              "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition",
              selected ? "left-7" : "left-1",
            )}
          />
        </button>
      </div>
      {expanded ? <p className="pl-[52px] pt-3 text-sm font-medium text-slate-500">{addOn.description}</p> : null}
    </div>
  );
}

function ResultCard({
  quoteResult,
  onDiscard,
  onSave,
}: {
  quoteResult: QuoteResult;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(true);

  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Quote Result</h2>
        <button type="button" onClick={onDiscard} className="grid h-9 w-9 place-items-center rounded-full bg-mist text-ink" aria-label="Discard quote">
          <X size={16} />
        </button>
      </div>

      <QuoteTotalPanel quoteResult={quoteResult} />

      <div className="mt-4 rounded-[20px] border border-line bg-white p-4">
        <button
          type="button"
          onClick={() => setShowBreakdown((value) => !value)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-ink"
        >
          Quote Breakdown
          {showBreakdown ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>

        {showBreakdown ? (
          <QuoteBreakdown quoteResult={quoteResult} />
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button className="secondary-button w-full" type="button" onClick={onDiscard}>
          Disregard Quote
        </button>
        <button className="primary-button w-full" type="button" onClick={onSave}>
          Save Quote
        </button>
      </div>
    </section>
  );
}

function QuoteTotalPanel({ quoteResult }: { quoteResult: QuoteResult }) {
  const selectedAddOns = addOns.filter((addOn) => quoteResult.input.addOns[addOn.key]).map((addOn) => addOn.title);

  return (
    <div className="mt-4 rounded-[24px] border border-blue-200 bg-gradient-to-br from-accent-soft to-white p-5">
      <p className="text-sm font-semibold text-accent">{quoteResult.input.priceListType}</p>
      <p className="mt-4 text-sm font-semibold text-slate-500">Final Total</p>
      <p className="mt-1 text-4xl font-bold text-ink">{formatCurrency(quoteResult.totalPrice)}</p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <MetricPill title="Pole Centre" value={formatMetres(quoteResult.roundedPoleCentre)} />
        <MetricPill title="Drop" value={formatMetres(quoteResult.roundedDrop)} />
      </div>

      {selectedAddOns.length ? (
        <p className="mt-4 text-sm font-semibold text-accent">{selectedAddOns.join(" • ")}</p>
      ) : null}
    </div>
  );
}

function QuoteBreakdown({ quoteResult }: { quoteResult: QuoteResult }) {
  return (
    <div className="mt-4 space-y-4">
      <BreakdownGroup title="Measurements">
        <DetailRow label="Selected pricing" value={quoteResult.input.priceListType} />
        <DetailRow label="Units" value={quoteResult.input.measurementUnit} />
        <DetailRow label="Entered pole centre" value={formatMeasurement(quoteResult.input.poleCentre, quoteResult.input.measurementUnit)} />
        <DetailRow label="Entered drop" value={formatMeasurement(quoteResult.input.drop, quoteResult.input.measurementUnit)} />
        <DetailRow label="Converted pole centre" value={formatMetres(quoteResult.convertedPoleCentreMetres)} />
        <DetailRow label="Converted drop" value={formatMetres(quoteResult.convertedDropMetres)} />
        <DetailRow label="Rounded pole centre" value={formatMetres(quoteResult.roundedPoleCentre)} />
        <DetailRow label="Rounded drop" value={formatMetres(quoteResult.roundedDrop)} />
      </BreakdownGroup>

      <BreakdownGroup title="Quote Breakdown">
        <DetailRow label="Base matrix price" value={formatCurrency(quoteResult.basePrice)} />
        {quoteResult.printCost !== null ? <DetailRow label="Print" value={formatCurrency(quoteResult.printCost)} /> : null}
        {quoteResult.tapeCost !== null ? <DetailRow label="Sticky Tape" value={formatCurrency(quoteResult.tapeCost)} /> : null}
        {quoteResult.fittingCost !== null ? <DetailRow label="Fitting" value={formatCurrency(quoteResult.fittingCost)} /> : null}
        {quoteResult.deliveryCost !== null ? <DetailRow label="Delivery Cost" value={formatCurrency(quoteResult.deliveryCost)} /> : null}
        <DetailRow label="Final total" value={formatCurrency(quoteResult.totalPrice)} emphasize />
      </BreakdownGroup>
    </div>
  );
}

function MetricPill({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/80 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function BreakdownGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-mist p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={clsx("text-right font-semibold", emphasize ? "text-accent" : "text-ink")}>{value}</span>
    </div>
  );
}
