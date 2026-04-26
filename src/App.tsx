/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, 
  Settings, 
  Plus, 
  MessageCircle, 
  Clock, 
  Trash2, 
  Edit2, 
  History, 
  Smartphone,
  ChevronRight,
  LogOut,
  Sparkles,
  CheckCircle2,
  Bell,
  Sun,
  Moon
} from 'lucide-react';
import { 
  auth, 
  db, 
  signOut, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onSnapshot, 
  collection, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDoc,
  setDoc,
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';
import { User } from 'firebase/auth';
import { Partner, Schedule, MessageLog, UserProfile, Template } from './types';
import { ROMANTIC_TEMPLATES } from './constants';
import { cn } from './lib/utils';
import { format } from 'date-fns';

const formatWhatsAppUrl = (phone: string, message: string) => {
  // Basic normalization: remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  // If user included leading zeros, remove them if they also included a country code
  // This is tricky, but let's just use the cleaned number and warn the user.
  return `https://api.whatsapp.com/send?phone=${cleaned}&text=${encodeURIComponent(message)}`;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [userTemplates, setUserTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [view, setView] = useState<'dashboard' | 'partners' | 'templates' | 'logs'>('dashboard');
  const [pendingTemplateMessage, setPendingTemplateMessage] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setUser(user);
      if (user) {
        try {
          const profileDoc = await getDoc(doc(db, 'users', user.uid));
          if (profileDoc.exists()) {
            setProfile(profileDoc.data() as UserProfile);
          }
        } catch (err) {
          console.error("Error fetching profile:", err);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setPartners([]);
      setSchedules([]);
      setLogs([]);
      return;
    }

    const qPartners = query(collection(db, 'partners'), where('ownerId', '==', user.uid));
    const unsubPartners = onSnapshot(qPartners, (snapshot) => {
      setPartners(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Partner)));
    }, err => handleFirestoreError(err, OperationType.GET, 'partners'));

    const qSchedules = query(collection(db, 'schedules'), where('ownerId', '==', user.uid));
    const unsubSchedules = onSnapshot(qSchedules, (snapshot) => {
      setSchedules(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Schedule)));
    }, err => handleFirestoreError(err, OperationType.GET, 'schedules'));

    const qLogs = query(collection(db, 'logs'), where('ownerId', '==', user.uid));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MessageLog)));
    }, err => handleFirestoreError(err, OperationType.GET, 'logs'));

    const qUserTemplates = query(collection(db, 'user_templates'), where('ownerId', '==', user.uid));
    const unsubUserTemplates = onSnapshot(qUserTemplates, (snapshot) => {
      setUserTemplates(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Template)));
    }, err => handleFirestoreError(err, OperationType.GET, 'user_templates'));

    return () => {
      unsubPartners();
      unsubSchedules();
      unsubLogs();
      unsubUserTemplates();
    };
  }, [user]);

  // Daily message ticker logic
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      const now = new Date();
      const currentH = now.getHours().toString().padStart(2, '0');
      const currentM = now.getMinutes().toString().padStart(2, '0');
      const currentTime = `${currentH}:${currentM}`;
      const currentDay = now.getDay();

      schedules.forEach(schedule => {
        if (schedule.active && schedule.time === currentTime && schedule.days.includes(currentDay)) {
          // Privacy and trial check
          if (!profile?.isPremium && logs.length >= 5) {
            return; // Don't notify if trial expired
          }
          // Check if already sent today to prevent spam
          const lastSentDate = schedule.lastSent ? new Date(schedule.lastSent).toDateString() : '';
          if (lastSentDate !== now.toDateString()) {
            notifyReady(schedule);
          }
        }
      });
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [user, schedules]);

  const notifyReady = (schedule: Schedule) => {
    const partner = partners.find(p => p.id === schedule.partnerId);
    if (!partner) return;

    if (Notification.permission === 'granted') {
      const notification = new Notification('Lumina Muse: Time to send love!', {
        body: `Tap to send your scheduled message to ${partner.name}.`,
        icon: 'https://cdn-icons-png.flaticon.com/512/2589/2589175.png',
        tag: schedule.id // Prevent duplicate notifications
      });

      notification.onclick = () => {
        window.focus();
        sendWhatsApp(schedule, partner, profile, logs.length);
      };
    } else {
      // Fallback if notifications are off - we just mark it as "ready" visually or something
      // For now, let's just update the DB
    }
    // We update lastSent to mark it ready/notified
    updateDoc(doc(db, 'schedules', schedule.id), { lastSent: Date.now() });
  };

  const handleRequestNotifications = async () => {
    const res = await Notification.requestPermission();
    if (res === 'granted') {
      new Notification("Lumina Muse Active", { body: "Automation is ready! You'll receive alerts when it's time to muse." });
    } else {
      alert('Notifications are blocked. Please enable them in your browser settings for automation to work.');
    }
  };

  const [isAddingSchedule, setIsAddingSchedule] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  // ... (existing helper functions)

  const handleSaveSchedule = async (scheduleData: Partial<Schedule>) => {
    try {
      if (editingSchedule) {
        await updateDoc(doc(db, 'schedules', editingSchedule.id), scheduleData);
      } else {
        await addDoc(collection(db, 'schedules'), {
          ...scheduleData,
          ownerId: user.uid,
          active: true,
          lastSent: 0
        });
      }
      setIsAddingSchedule(false);
      setEditingSchedule(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'schedules');
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (window.confirm("Delete this schedule?")) {
      await deleteDoc(doc(db, 'schedules', id));
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-bg-primary"><Heart className="animate-pulse text-accent-rose h-12 w-12" /></div>;

  if (!user) return <AuthPage onAuthSuccess={(u, p) => { setUser(u); setProfile(p); }} />;

  return (
    <div className="min-h-screen bg-bg-primary pb-24 text-text-main">
      {/* Header */}
      <header className="p-6 flex justify-between items-center bg-bg-secondary/50 backdrop-blur-xl sticky top-0 z-10 border-b border-border-subtle">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Heart className="text-accent-rose fill-accent-rose w-5 h-5" />
            <h1 className="text-2xl font-serif italic text-accent-rose tracking-tighter">Lumina Muse</h1>
          </div>
          <span className="text-[10px] text-gray-500 uppercase tracking-[0.2em] mt-1">Devotion Automated</span>
        </div>
        <div className="flex items-center gap-2">
          {Notification.permission !== 'granted' && (
            <button 
              onClick={handleRequestNotifications}
              className="p-2 rounded-full hover:bg-bg-secondary transition-colors text-accent-rose animate-pulse"
              title="Enable Automation"
            >
              <Bell className="w-5 h-5" />
            </button>
          )}
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-full hover:bg-bg-secondary transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5 text-accent-rose" /> : <Moon className="w-5 h-5 text-gray-400" />}
          </button>
          <button onClick={handleLogout} className="p-2 rounded-full hover:bg-bg-secondary transition-colors">
            <LogOut className="w-5 h-5 opacity-40" />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
              <div className="romantic-card-filled flex items-center justify-between group cursor-pointer border-rose-500/20 hover:border-rose-500/40">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-rose-500/20 rounded-xl"><Sparkles className="w-4 h-4 text-accent-rose" /></div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-accent-rose">
                      {profile?.isPremium ? 'Lumina Pro ✨' : 'Basic Member'}
                    </p>
                    <p className="text-sm">
                      {profile?.isPremium ? 'Enjoying Unlimited Musings' : 'Unlock Pro Templates'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 opacity-20 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Analytics Summary */}
              <div className="romantic-card bg-bg-secondary border-rose-900/30">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Messages Sent Today</p>
                    <h2 className="text-5xl font-light tracking-tighter">
                      {logs.filter(l => new Date(l.sentAt).toDateString() === new Date().toDateString()).length < 10 ? '0' : ''}{logs.filter(l => new Date(l.sentAt).toDateString() === new Date().toDateString()).length}
                    </h2>
                  </div>
                  <History className="text-accent-rose/40" />
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-accent-rose shadow-[0_0_8px_rgba(253,164,175,0.5)] transition-all duration-1000" 
                    style={{ width: `${Math.min(100, (logs.length / 10) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setView('partners')} className="romantic-card bg-bg-secondary flex flex-col items-center gap-3 p-6 text-center group border-white/5 hover:border-accent-rose/20">
                  <div className="p-3 bg-white/5 rounded-2xl group-hover:scale-110 transition-transform group-hover:bg-accent-rose/10">
                    < Smartphone className="w-6 h-6 text-accent-rose" />
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-widest text-gray-400">Partners</span>
                </button>
                <button onClick={() => setView('templates')} className="romantic-card bg-bg-secondary flex flex-col items-center gap-3 p-6 text-center group border-white/5 hover:border-accent-rose/20">
                  <div className="p-3 bg-white/5 rounded-2xl group-hover:scale-110 transition-transform group-hover:bg-accent-rose/10">
                    <MessageCircle className="w-6 h-6 text-accent-rose" />
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-widest text-gray-400">Templates</span>
                </button>
              </div>

              {/* Active Schedules */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">Scheduled Musings</h2>
                  {partners.length > 0 && (
                    <button onClick={() => setIsAddingSchedule(true)} className="p-2 bg-accent-rose/10 text-accent-rose rounded-full border border-accent-rose/30 hover:bg-accent-rose/20 transition-all font-bold">
                      <Plus className="w-4 h-4 ml-0" />
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  {schedules.length === 0 ? (
                    <div className="p-12 text-center border-2 border-dashed border-white/5 rounded-[32px]">
                      <p className="text-gray-600 italic mb-4 text-sm">No scheduled musings yet.</p>
                      {partners.length === 0 ? (
                        <button onClick={() => setView('partners')} className="text-[10px] font-bold uppercase tracking-widest text-accent-rose hover:opacity-100 transition-opacity opacity-60">Add a partner first</button>
                      ) : (
                        <button onClick={() => setIsAddingSchedule(true)} className="text-[10px] font-bold uppercase tracking-widest text-accent-rose hover:opacity-100 transition-opacity opacity-60">Schedule your first musing</button>
                      )}
                    </div>
                  ) : (
                    schedules.map(schedule => (
                      <ScheduleCard 
                        key={schedule.id} 
                        schedule={schedule} 
                        partnerName={partners.find(p => p.id === schedule.partnerId)?.name || 'Unknown'}
                        onSend={() => sendWhatsApp(schedule, partners.find(p => p.id === schedule.partnerId), profile, logs.length)}
                        onEdit={() => {
                          setEditingSchedule(schedule);
                          setIsAddingSchedule(true);
                        }}
                        onDelete={() => handleDeleteSchedule(schedule.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            </motion.div>
          )}

          {view === 'partners' && (
            <PartnersView
              partners={partners}
              onBack={() => setView('dashboard')}
              userId={user.uid}
              profile={profile}
            />
          ) || null}

          {view === 'templates' && (
            <TemplatesView
              userTemplates={userTemplates}
              partners={partners}
              userId={user.uid}
              onBack={() => setView('dashboard')}
              onSelect={(text) => {
                setEditingSchedule(null);
                setIsAddingSchedule(true);
                setPendingTemplateMessage(text);
              }}
            />
          ) || null}

          {view === 'logs' && (
            <LogsView logs={logs} onBack={() => setView('dashboard')} />
          ) || null}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isAddingSchedule && (
          <ScheduleFormModal
            partners={partners}
            schedule={editingSchedule}
            initialMessage={pendingTemplateMessage}
            onClose={() => {
              setIsAddingSchedule(false);
              setEditingSchedule(null);
              setPendingTemplateMessage(null);
            }}
            onSave={handleSaveSchedule}
          />
        )}
      </AnimatePresence>

      {/* Navigation */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-sm bg-bg-secondary/80 backdrop-blur-xl rounded-full shadow-2xl border border-border-subtle p-2 flex justify-around items-center z-20">
        <NavButton icon={Heart} active={view === 'dashboard'} onClick={() => setView('dashboard')} label="Home" />
        <NavButton icon={Smartphone} active={view === 'partners'} onClick={() => setView('partners')} label="Partners" />
        <NavButton icon={MessageCircle} active={view === 'templates'} onClick={() => setView('templates')} label="Templates" />
        <NavButton icon={History} active={view === 'logs'} onClick={() => setView('logs')} label="History" />
      </nav>
    </div>
  );
}

function NavButton({ icon: Icon, active, onClick, label }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all relative",
        active ? "text-accent-rose bg-bg-secondary" : "text-gray-500 hover:text-gray-700"
      )}
    >
      <Icon className={cn("w-5 h-5", active && "drop-shadow-[0_0_8px_rgba(253,164,175,0.4)]")} />
      <span className="text-[9px] uppercase tracking-widest font-bold">{label}</span>
      {active && <motion.div layoutId="nav-glow" className="absolute -bottom-1 w-6 h-0.5 bg-accent-rose rounded-full blur-[1px]" />}
    </button>
  );
}

function ScheduleCard({ schedule, partnerName, onSend, onEdit, onDelete }: any) {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return (
    <div className="romantic-card group relative hover:border-accent-rose/20 bg-bg-secondary shadow-lg">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1 pr-4">
          <h4 className="text-xl leading-tight font-serif italic text-accent-rose">{partnerName}</h4>
          <div className="flex items-center gap-2 mt-1">
            <Clock className="w-3 h-3 text-accent-rose/60" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{schedule.time}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="p-2 text-gray-500 hover:text-accent-rose transition-colors">
            <Edit2 className="w-4 h-4" />
          </button>
          <button 
            onClick={onSend} 
            className="bg-accent-rose text-black px-5 py-3 rounded-2xl hover:scale-105 transition-transform active:scale-95 shadow-[0_4px_15px_rgba(253,164,175,0.3)] flex items-center gap-2 text-xs font-bold uppercase tracking-widest border border-accent-rose"
          >
            <MessageCircle className="w-4 h-4 fill-black" />
            Send Now
          </button>
        </div>
      </div>
      <p className="font-sans text-sm text-gray-400 dark:text-gray-400 line-clamp-2 mb-6 italic leading-relaxed px-1">"{schedule.message}"</p>
      <div className="flex items-center justify-between mt-auto">
        <div className="flex gap-1">
          {days.map((day, i) => (
            <div 
              key={i} 
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-full text-[10px] font-bold transition-all border",
                schedule.days.includes(i) ? "bg-accent-rose/20 border-accent-rose/40 text-accent-rose shadow-[0_0_10px_rgba(253,164,175,0.1)]" : "border-border-subtle text-gray-700"
              )}
            >
              {day}
            </div>
          ))}
        </div>
        <button onClick={onDelete} className="p-2 text-red-500/20 hover:text-red-500 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ScheduleFormModal({ partners, schedule, initialMessage, onClose, onSave }: { partners: Partner[], schedule: Schedule | null, initialMessage?: string | null, onClose: () => void, onSave: (data: Partial<Schedule>) => void }) {
  const [partnerId, setPartnerId] = useState(schedule?.partnerId || (partners.length > 0 ? partners[0].id : ''));
  const [time, setTime] = useState(schedule?.time || '08:00');
  const [message, setMessage] = useState(schedule?.message || initialMessage || '');
  const [days, setDays] = useState<number[]>(schedule?.days || [1,2,3,4,5]);

  const toggleDay = (day: number) => {
    setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4">
      <motion.div 
        initial={{ y: 100 }} 
        animate={{ y: 0 }} 
        exit={{ y: 100 }}
        className="bg-bg-secondary w-full max-w-md rounded-[40px] p-8 border border-border-subtle shadow-2xl overflow-hidden relative text-text-main"
      >
        <div className="absolute top-0 left-0 p-6">
           <button onClick={onClose} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent-rose transition-colors">
             <ChevronRight className="w-4 h-4 rotate-180" />
             Back
           </button>
        </div>
        <div className="absolute top-0 right-0 p-6">
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full"><Plus className="w-5 h-5 rotate-45 opacity-20" /></button>
        </div>

        <h3 className="text-3xl italic mb-8 uppercase tracking-tighter font-serif text-accent-rose">{schedule ? 'Refine Muse' : 'New Musing'}</h3>

        <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2 pb-6 custom-scrollbar">
          {!schedule && (
            <div className="p-4 bg-accent-rose/5 rounded-2xl border border-accent-rose/10 mb-2">
               <p className="text-[10px] uppercase font-bold tracking-widest text-accent-rose mb-1">💡 Smart Automation</p>
               <p className="text-xs text-gray-500 leading-relaxed italic">Once scheduled, Lumina will prepare your message and notify you. A single tap on the alert will deliver the devotion via WhatsApp.</p>
            </div>
          )}
          <section>
            <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-600 mb-4 block">Recipient</label>
            <div className="flex gap-2">
              {partners.map(p => (
                <button 
                  key={p.id} 
                  onClick={() => setPartnerId(p.id)}
                  className={cn(
                    "flex-1 p-4 rounded-2xl border transition-all text-xs font-bold uppercase tracking-widest",
                    partnerId === p.id ? "bg-accent-rose text-black border-accent-rose shadow-lg shadow-rose-900/20" : "bg-white/5 border-white/5 text-gray-500 hover:text-gray-300"
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-600 mb-4 block">Delivery Time</label>
            <input 
              type="time" 
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full bg-white/5 p-6 rounded-3xl border border-white/10 text-4xl font-light tracking-tighter outline-none focus:border-accent-rose/40 transition-colors"
            />
          </section>

          <section>
            <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-600 mb-4 block">Repeat Schedule</label>
            <div className="flex justify-between">
              {['S','M','T','W','T','F','S'].map((day, i) => (
                <button 
                  key={i} 
                  onClick={() => toggleDay(i)}
                  className={cn(
                    "w-10 h-10 rounded-full text-[10px] font-bold transition-all border",
                    days.includes(i) ? "bg-accent-rose/10 border-accent-rose/40 text-accent-rose shadow-md" : "bg-white/5 border-white/5 text-gray-700"
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
          </section>

          <section>
            <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-600 mb-4 block">The Note</label>
            <textarea 
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="What would you like to say..."
              className="w-full bg-white/5 p-6 rounded-3xl border border-white/10 text-base italic resize-none outline-none focus:border-accent-rose/40 transition-colors leading-relaxed text-gray-300 placeholder:text-gray-700"
            />
          </section>
        </div>

        <button 
          onClick={() => onSave({ partnerId, time, message, days })}
          className="w-full bg-accent-rose text-black py-5 mt-6 rounded-2xl font-bold hover:bg-accent-rose/90 transition-all shadow-xl shadow-rose-900/20 active:scale-[0.98]"
        >
          {schedule ? 'Save Changes' : 'Schedule Devotion'}
        </button>
      </motion.div>
    </motion.div>
  );
}

function AuthPage({ onAuthSuccess }: { onAuthSuccess: (user: User, profile: UserProfile) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        console.log("Attempting login with:", email);
        const { user: firebaseUser } = await signInWithEmailAndPassword(auth, email, password);
        const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (profileDoc.exists()) {
          onAuthSuccess(firebaseUser, profileDoc.data() as UserProfile);
        } else {
          setError("Profile not found. Please contact support.");
        }
      } else {
        console.log("Attempting signup with:", email);
        const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email, password);
        const newUserProfile: UserProfile = {
          uid: firebaseUser.uid,
          name,
          email,
          phone,
          gender,
          createdAt: Date.now(),
        };
        await setDoc(doc(db, 'users', firebaseUser.uid), newUserProfile);
        onAuthSuccess(firebaseUser, newUserProfile);
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err?.message || "An error occurred during authentication.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center bg-bg-primary p-6 text-center text-text-main">
      {/* Decorative background Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-accent-rose/10 rounded-full blur-3xl opacity-30" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-accent-rose/10 rounded-full blur-3xl opacity-20" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="z-10 w-full max-w-sm"
      >
        <div className="w-20 h-20 bg-bg-secondary rounded-[28px] shadow-xl border border-border-subtle mx-auto mb-8 flex items-center justify-center rotate-3">
          <Heart className="w-10 h-10 text-accent-rose fill-accent-rose" />
        </div>
        
        <h1 className="text-4xl italic mb-2 text-accent-rose tracking-tighter font-serif">Lumina Muse</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed text-sm tracking-wide">
          {isLogin ? 'Welcome back to your romantic ritual.' : 'Begin your journey of automated affection.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          {!isLogin && (
            <>
              <div>
                <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500 mb-2 block ml-2">Full Name</label>
                <input 
                  required
                  type="text"
                  placeholder="Your Name"
                  className="w-full bg-bg-secondary border border-border-subtle rounded-2xl p-4 text-sm focus:border-accent-rose/30 transition-all outline-none"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500 mb-2 block ml-2">WhatsApp Number</label>
                <input 
                  required
                  type="tel"
                  placeholder="+234..."
                  className="w-full bg-bg-secondary border border-border-subtle rounded-2xl p-4 text-sm focus:border-accent-rose/30 transition-all outline-none"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500 mb-2 block ml-2">Gender</label>
                <div className="flex gap-2">
                  {(['male', 'female', 'other'] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(g)}
                      className={cn(
                        "flex-1 p-3 rounded-xl border text-[10px] uppercase font-bold tracking-widest transition-all",
                        gender === g ? "bg-accent-rose/10 border-accent-rose/40 text-accent-rose" : "bg-bg-secondary border-border-subtle text-gray-400"
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500 mb-2 block ml-2">Email Address</label>
            <input 
              required
              type="email"
              placeholder="muse@example.com"
              className="w-full bg-bg-secondary border border-border-subtle rounded-2xl p-4 text-sm focus:border-accent-rose/30 transition-all outline-none"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-500 mb-2 block ml-2">Password</label>
            <input 
              required
              type="password"
              placeholder="••••••••"
              className="w-full bg-bg-secondary border border-border-subtle rounded-2xl p-4 text-sm focus:border-accent-rose/30 transition-all outline-none"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs text-center px-2">{error}</p>
          )}

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-accent-rose text-black py-4 rounded-2xl font-bold transition-all shadow-xl shadow-rose-900/20 hover:scale-[1.02] active:scale-98 disabled:opacity-50 disabled:scale-100 flex justify-center items-center gap-2"
          >
            {loading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : (isLogin ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-border-subtle">
          <p className="text-[10px] text-gray-500 font-sans leading-relaxed text-center px-4 uppercase tracking-[0.05em]">
            <span className="text-accent-rose font-bold block mb-1 underline">Privacy Assurance</span>
            Your personal information, messages, and partner data are encrypted and saved securely for your use only. We never share or use your data for any other purpose.
          </p>
        </div>
        
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <p className="text-gray-500 text-sm">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button 
              onClick={() => setIsLogin(!isLogin)}
              className="ml-2 text-accent-rose font-bold hover:underline"
            >
              {isLogin ? 'Sign Up' : 'Log In'}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// --- Sub Views ---

function PartnersView({ partners, onBack, userId, profile }: { partners: Partner[], onBack: () => void, userId: string, profile: UserProfile | null }) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = profile?.isPremium ? 100 : 2;
    if (partners.length >= limit) {
      alert(`Free users can only add up to 2 partners. Please upgrade to Pro for more!`);
      return;
    }
    try {
      await addDoc(collection(db, 'partners'), {
        name,
        phone,
        ownerId: userId,
        createdAt: Date.now()
      });
      setName('');
      setPhone('');
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'partners');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to remove this partner?")) {
      await deleteDoc(doc(db, 'partners', id));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="p-2 -ml-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
          <ChevronRight className="w-6 h-6 rotate-180 opacity-40 hover:opacity-100 transition-opacity" />
          Back
        </button>
        <h3 className="text-2xl italic">Partner Profiles</h3>
      </div>

      <div className="space-y-4">
        {partners.map(p => (
          <div key={p.id} className="romantic-card bg-bg-secondary flex items-center justify-between group border-white/5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center font-serif italic text-xl text-accent-rose drop-shadow-[0_0_5px_rgba(253,164,175,0.2)]">
                {p.name[0]}
              </div>
              <div>
                <h4 className="text-lg leading-tight">{p.name}</h4>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-0.5">{p.phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => {
                  const url = formatWhatsAppUrl(p.phone, "Hello my love...");
                  window.open(url, '_blank');
                }}
                className="p-2 text-accent-rose hover:bg-accent-rose/10 rounded-full transition-colors"
                title="Send Instant Message"
              >
                <MessageCircle className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(p.id)} className="p-2 text-white/10 hover:text-red-400 transition-all">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {isAdding ? (
          <form onSubmit={handleAdd} className="romantic-card bg-bg-secondary space-y-4 border-accent-rose/20 animate-in fade-in slide-in-from-top-2">
            <input 
              required
              placeholder="Name (e.g. My Queen)" 
              className="w-full bg-white/5 p-5 rounded-2xl outline-none border border-white/5 focus:border-accent-rose/30 transition-all text-sm italic"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input 
              required
              type="tel"
              placeholder="WhatsApp Number (e.g. 234803...)" 
              className="w-full bg-white/5 p-5 rounded-2xl outline-none border border-white/5 focus:border-accent-rose/30 transition-all text-sm font-sans"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
            <p className="text-[9px] text-gray-500 italic px-2">Include country code: 234 for Nigeria, 1 for USA, etc. No + or -</p>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="flex-1 bg-accent-rose text-black py-4 rounded-xl font-bold hover:bg-accent-rose/90 transition-all text-sm">Verify & Add</button>
              <button type="button" onClick={() => setIsAdding(false)} className="flex-1 bg-white/5 py-4 rounded-xl font-bold hover:bg-white/10 transition-all text-sm text-gray-400">Cancel</button>
            </div>
          </form>
        ) : (
          partners.length < 3 && (
            <button onClick={() => setIsAdding(true)} className="w-full border-2 border-dashed border-white/5 rounded-[32px] p-8 text-gray-600 flex flex-col items-center justify-center gap-3 hover:border-accent-rose/20 hover:text-accent-rose/60 transition-all group overflow-hidden relative">
              <div className="p-3 bg-white/5 rounded-2xl group-hover:bg-accent-rose/10 transition-colors">
                <Smartphone className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Add Recipient ({3 - partners.length} slots left)</span>
              <div className="absolute inset-0 bg-gradient-to-br from-accent-rose/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )
        )}
      </div>
    </motion.div>
  );
}

function TemplatesView({ onBack, onSelect, userTemplates, userId, partners }: { onBack: () => void, onSelect: (text: string) => void, userTemplates: Template[], userId: string, partners: Partner[] }) {
  const [isAdding, setIsAdding] = useState(false);
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');

  const builtInCategories = Array.from(new Set(ROMANTIC_TEMPLATES.map(t => t.category)));
  const userCategories = Array.from(new Set(userTemplates.map(t => t.category)));
  const allCategories = Array.from(new Set([...builtInCategories, ...userCategories]));

  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'user_templates'), {
        ownerId: userId,
        category: category.toLowerCase(),
        text,
        createdAt: Date.now()
      });
      setCategory('');
      setText('');
      setIsAdding(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'user_templates');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (window.confirm("Remove this custom muse?")) {
      await deleteDoc(doc(db, 'user_templates', id));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8 pb-32">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent-rose transition-colors">
          <ChevronRight className="w-6 h-6 rotate-180 opacity-40 group-hover:opacity-100 transition-opacity" />
          Back
        </button>
        <h3 className="text-2xl italic">Muse Library</h3>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="p-2 bg-accent-rose text-black rounded-full shadow-lg hover:scale-105 transition-transform"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.form 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            onSubmit={handleAddTemplate} 
            className="romantic-card bg-bg-secondary space-y-4 overflow-hidden border-accent-rose/30"
          >
            <div>
              <label className="text-[10px] uppercase font-bold tracking-widest text-gray-500 mb-2 block">Category</label>
              <input 
                required
                placeholder="e.g. Special Occasions"
                className="w-full bg-white/5 p-4 rounded-xl border border-white/5 text-sm outline-none focus:border-accent-rose/40"
                value={category}
                onChange={e => setCategory(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold tracking-widest text-gray-500 mb-2 block">Message Text</label>
              <textarea 
                required
                rows={3}
                placeholder="Write your beautiful msuing here..."
                className="w-full bg-white/5 p-4 rounded-xl border border-white/5 text-sm outline-none focus:border-accent-rose/40 resize-none italic"
                value={text}
                onChange={e => setText(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 bg-accent-rose text-black py-3 rounded-xl font-bold text-sm">Save Personal Muse</button>
              <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-3 bg-white/5 rounded-xl text-xs font-bold text-gray-400">Cancel</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="space-y-12">
        {allCategories.map(cat => (
          <div key={cat} className="space-y-4">
            <h4 className="text-[10px] uppercase tracking-[0.3em] font-bold text-accent-rose/60 pl-1">{cat}</h4>
            <div className="grid grid-cols-1 gap-4">
              {[...ROMANTIC_TEMPLATES, ...userTemplates]
                .filter(t => t.category === cat)
                .map(t => (
                  <div 
                    key={t.id} 
                    className="romantic-card bg-bg-secondary p-6 hover:border-accent-rose/40 transition-all group relative"
                  >
                    <p className="italic text-gray-300 dark:text-gray-300 mb-4 leading-relaxed text-sm">"{t.text}"</p>
                    <div className="flex justify-between items-center pt-2 border-t border-border-subtle">
                      <button 
                        onClick={() => onSelect(t.text)}
                        className="text-[9px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent-rose transition-colors flex items-center gap-2"
                      >
                        <Plus className="w-3 h-3" />
                        Schedule
                      </button>
                      <div className="flex items-center gap-2">
                        {partners.map(p => (
                          <button 
                            key={p.id}
                            onClick={() => {
                              const url = formatWhatsAppUrl(p.phone, t.text);
                              window.open(url, '_blank');
                              // Create a log without a schedule
                              addDoc(collection(db, 'logs'), {
                                scheduleId: 'instant',
                                ownerId: userId,
                                partnerName: p.name,
                                message: t.text,
                                sentAt: Date.now(),
                                status: 'sent'
                              });
                            }}
                            className="text-[9px] font-bold text-accent-rose/60 hover:text-accent-rose transition-colors px-2 py-1 bg-accent-rose/5 rounded-lg whitespace-nowrap"
                            title={`Send to ${p.name}`}
                          >
                            Send to {p.name.split(' ')[0]}
                          </button>
                        ))}
                      </div>
                      {t.ownerId && (
                        <button onClick={() => handleDeleteTemplate(t.id)} className="p-2 text-red-500/20 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function LogsView({ logs, onBack }: { logs: MessageLog[], onBack: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8">
      <div className="flex items-center gap-4 mb-4">
        <button onClick={onBack} className="p-2 -ml-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-accent-rose transition-colors">
          <ChevronRight className="w-6 h-6 rotate-180 opacity-40 group-hover:opacity-100 transition-opacity" />
          Back
        </button>
        <h3 className="text-2xl italic">Musing Archives</h3>
      </div>

      <div className="space-y-4">
        {logs.sort((a,b) => b.sentAt - a.sentAt).map(log => (
          <div key={log.id} className="romantic-card bg-bg-secondary relative overflow-hidden group border-white/5">
            <div className="absolute top-0 right-0 p-4">
              {log.status === 'sent' ? (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-green-500/50 uppercase tracking-widest">Delivered</span>
                  <CheckCircle2 className="w-3 h-3 text-green-500/50" />
                </div>
              ) : (
                <Clock className="w-3 h-3 text-gray-700" />
              )}
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center font-serif italic text-lg text-accent-rose/60 border border-white/5">
                {log.partnerName[0]}
              </div>
              <div>
                <h4 className="text-sm font-medium">{log.partnerName}</h4>
                <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">{format(log.sentAt, 'MMM d, h:mm a')}</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 italic leading-relaxed px-1">"{log.message}"</p>
            <div className="absolute -bottom-4 -right-4 w-12 h-12 bg-accent-rose/5 blur-xl rounded-full" />
          </div>
        ))}
      </div>
    </motion.div>
  );
}

async function sendWhatsApp(schedule: Schedule, partner: Partner | undefined, profile: UserProfile | null, logsCount: number) {
  if (!partner) return;

  if (!profile?.isPremium && logsCount >= 5) {
    alert("Free trial expired! You have used your 5 free musings. Please subscribe to continue sending automated love.");
    return;
  }

  const url = formatWhatsAppUrl(partner.phone, schedule.message);
  
  // Create a log entry
  try {
    await addDoc(collection(db, 'logs'), {
      scheduleId: schedule.id,
      ownerId: schedule.ownerId,
      partnerName: partner.name,
      message: schedule.message,
      sentAt: Date.now(),
      status: 'sent'
    });
    // Update schedule lastSent
    await updateDoc(doc(db, 'schedules', schedule.id), { lastSent: Date.now() });
    
    // Open WhatsApp
    window.open(url, '_blank');
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'logs');
  }
}

