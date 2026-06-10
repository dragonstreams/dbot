import { useState, useMemo } from "react";
import { Switch as WouterSwitch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Server, User, KeyRound, Copy, Check, Tv, Film, ChevronRight, Loader2, RefreshCw } from "lucide-react";

import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import { useJellyfinAuth, useGetJellyfinLibraries, getGetJellyfinLibrariesQueryKey } from "@workspace/api-client-react";
import type { JellyfinCredentials } from "@workspace/api-client-react";

const queryClient = new QueryClient();

// Auth form schema
const authSchema = z.object({
  serverUrl: z.string().url({ message: "Please enter a valid URL (e.g. https://jellyfin.example.com)" }),
  username: z.string().min(1, { message: "Username is required" }),
  password: z.string().min(1, { message: "Password is required" }),
});

type AuthFormValues = z.infer<typeof authSchema>;

function ConfigWizard() {
  const { toast } = useToast();
  
  // App state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [credentials, setCredentials] = useState<JellyfinCredentials | null>(null);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
  const [manifestUrl, setManifestUrl] = useState<string>("");
  const [isCopied, setIsCopied] = useState(false);

  // Mutations & Queries
  const authMutation = useJellyfinAuth();
  
  const libParams = {
    serverUrl: credentials?.serverUrl || "",
    userId: credentials?.userId || "",
    accessToken: credentials?.accessToken || "",
  };
  const { data: librariesList, isLoading: isLoadingLibraries, isError: isLibrariesError, error: librariesError } = useGetJellyfinLibraries(
    libParams,
    {
      query: {
        enabled: step === 2 && !!credentials,
        queryKey: getGetJellyfinLibrariesQueryKey(libParams),
      }
    }
  );

  const libraries = useMemo(() => {
    return librariesList?.libraries?.filter(l => l.collectionType === "movies" || l.collectionType === "tvshows") || [];
  }, [librariesList]);

  // Handle initialization of selected libraries
  useMemo(() => {
    if (libraries.length > 0 && selectedLibraryIds.size === 0) {
      setSelectedLibraryIds(new Set(libraries.map(l => l.id)));
    }
  }, [libraries, selectedLibraryIds.size]);

  // Forms
  const authForm = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      serverUrl: "",
      username: "",
      password: "",
    },
  });

  function onAuthSubmit(data: AuthFormValues) {
    authMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          setCredentials(res);
          setStep(2);
          toast({
            title: "Authentication successful",
            description: "Connected to Jellyfin server.",
          });
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Connection failed",
            description: err.message || "Could not authenticate with the Jellyfin server. Please check your credentials.",
          });
        }
      }
    );
  }

  function handleToggleLibrary(id: string, enabled: boolean) {
    setSelectedLibraryIds(prev => {
      const next = new Set(prev);
      if (enabled) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function generateManifest() {
    if (!credentials) return;

    const enabledLibraries = libraries.filter(l => selectedLibraryIds.has(l.id));
    
    const config = {
      serverUrl: credentials.serverUrl,
      userId: credentials.userId,
      accessToken: credentials.accessToken,
      enabledLibraries
    };

    const encoded = btoa(JSON.stringify(config))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    const url = `${window.location.origin}/addon/${encoded}/manifest.json`;
    setManifestUrl(url);
    setStep(3);
  }

  function copyManifest() {
    navigator.clipboard.writeText(manifestUrl);
    setIsCopied(true);
    toast({
      title: "Copied!",
      description: "Manifest URL copied to clipboard.",
    });
    setTimeout(() => setIsCopied(false), 2000);
  }

  function startOver() {
    setStep(1);
    setCredentials(null);
    setSelectedLibraryIds(new Set());
    setManifestUrl("");
    authForm.reset();
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center py-16 px-4 font-sans selection:bg-primary/30">
      
      <div className="w-full max-w-md space-y-8">
        
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4 ring-1 ring-primary/20">
            <Tv className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Jellyfin for Stremio</h1>
          <p className="text-muted-foreground text-sm">Configure your personal media server addon</p>
        </div>

        {/* Steps Indicator */}
        <div className="flex items-center justify-center space-x-4 text-sm font-medium">
          <div className={`flex items-center ${step >= 1 ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 mr-2 ${step >= 1 ? 'border-primary bg-primary/10' : 'border-muted'}`}>1</div>
            Connect
          </div>
          <ChevronRight className="h-4 w-4 text-muted" />
          <div className={`flex items-center ${step >= 2 ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 mr-2 ${step >= 2 ? 'border-primary bg-primary/10' : 'border-muted'}`}>2</div>
            Libraries
          </div>
          <ChevronRight className="h-4 w-4 text-muted" />
          <div className={`flex items-center ${step >= 3 ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 mr-2 ${step >= 3 ? 'border-primary bg-primary/10' : 'border-muted'}`}>3</div>
            Install
          </div>
        </div>

        {/* Step 1: Connect */}
        {step === 1 && (
          <Card className="border-card-border bg-card/50 backdrop-blur shadow-2xl">
            <CardHeader>
              <CardTitle>Server Details</CardTitle>
              <CardDescription>Enter your Jellyfin server URL and credentials.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...authForm}>
                <form onSubmit={authForm.handleSubmit(onAuthSubmit)} className="space-y-4">
                  <FormField
                    control={authForm.control}
                    name="serverUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Server URL</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Server className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="https://jellyfin.example.com" className="pl-10 font-mono text-sm bg-background/50 border-muted" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={authForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="admin" className="pl-10 bg-background/50 border-muted" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={authForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="password" placeholder="••••••••" className="pl-10 bg-background/50 border-muted" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {authMutation.isError && (
                    <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                      <AlertTitle>Connection Failed</AlertTitle>
                      <AlertDescription>{authMutation.error?.message || "Invalid credentials or server unreachable."}</AlertDescription>
                    </Alert>
                  )}

                  <Button type="submit" className="w-full" disabled={authMutation.isPending}>
                    {authMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      "Connect to Jellyfin"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Libraries */}
        {step === 2 && (
          <Card className="border-card-border bg-card/50 backdrop-blur shadow-2xl">
            <CardHeader>
              <CardTitle>Select Libraries</CardTitle>
              <CardDescription>Choose which libraries to expose to Stremio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              
              {isLoadingLibraries && (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded bg-muted" />
                        <Skeleton className="h-5 w-32 bg-muted" />
                      </div>
                      <Skeleton className="h-5 w-9 rounded-full bg-muted" />
                    </div>
                  ))}
                </div>
              )}

              {isLibrariesError && (
                <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                  <AlertTitle>Error Loading Libraries</AlertTitle>
                  <AlertDescription>{librariesError?.message || "Failed to fetch libraries."}</AlertDescription>
                </Alert>
              )}

              {!isLoadingLibraries && !isLibrariesError && libraries.length === 0 && (
                <div className="text-center p-8 border border-dashed border-muted rounded-lg">
                  <Tv className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">No supported libraries found.</p>
                  <p className="text-xs text-muted-foreground mt-1">Requires 'movies' or 'tvshows' collections.</p>
                </div>
              )}

              {!isLoadingLibraries && libraries.map(lib => (
                <div key={lib.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10 text-primary">
                      {lib.collectionType === 'movies' ? <Film className="h-4 w-4" /> : <Tv className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{lib.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{lib.collectionType}</p>
                    </div>
                  </div>
                  <Switch 
                    checked={selectedLibraryIds.has(lib.id)}
                    onCheckedChange={(c) => handleToggleLibrary(lib.id, c)}
                  />
                </div>
              ))}

            </CardContent>
            <CardFooter className="flex justify-between border-t border-border pt-4">
              <Button variant="ghost" size="sm" onClick={startOver}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Start Over
              </Button>
              <Button 
                onClick={generateManifest} 
                disabled={selectedLibraryIds.size === 0 || isLoadingLibraries}
              >
                Generate Manifest
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 3: Install */}
        {step === 3 && (
          <Card className="border-card-border bg-card/50 backdrop-blur shadow-2xl">
            <CardHeader>
              <CardTitle>Installation Ready</CardTitle>
              <CardDescription>Install the addon in Stremio using this manifest link.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <div className="space-y-2">
                <Label>Manifest URL</Label>
                <div className="flex items-center gap-2">
                  <div className="relative w-full">
                    <Input 
                      readOnly 
                      value={manifestUrl} 
                      className="font-mono text-xs pr-12 bg-background border-primary/30 focus-visible:ring-primary/50 text-muted-foreground"
                    />
                    <div className="absolute right-0 top-0 bottom-0 flex items-center pr-2">
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-primary hover:text-primary hover:bg-primary/10" onClick={copyManifest}>
                        {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  How to install
                </h4>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside pl-1">
                  <li>Copy the Manifest URL above</li>
                  <li>Open the Stremio app</li>
                  <li>Go to <strong>Add-ons</strong></li>
                  <li>Select <strong>Community Add-ons</strong></li>
                  <li>Paste the URL in the search/input bar</li>
                  <li>Click <strong>Install</strong></li>
                </ol>
              </div>

            </CardContent>
            <CardFooter className="border-t border-border pt-4">
              <Button variant="outline" className="w-full" onClick={startOver}>
                Configure Another Server
              </Button>
            </CardFooter>
          </Card>
        )}

      </div>
    </div>
  );
}

function Router() {
  return (
    <WouterSwitch>
      <Route path="/" component={ConfigWizard} />
    </WouterSwitch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
