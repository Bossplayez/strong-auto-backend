'use client';

import { useState } from 'react';
import { Phone, Mail, MapPin, Clock } from 'lucide-react';
import { LeadForm } from '@/components/LeadForm';

export default function ContactsPage() {
  const [formSubmitted, setFormSubmitted] = useState(false);

  return (
    <main className="px-4 sm:px-8 py-6 sm:py-10 max-w-container mx-auto">
      <h1 className="font-display font-bold text-fg" style={{ fontSize: 32 }}>Зв&#39;яжіться з нами</h1>
      <p className="mt-2 text-fg-muted text-sm">
        Маєте питання? Зв&#39;яжіться з нами зручним для вас способом або залиште заявку.
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {/* Contact Info */}
        <div className="space-y-4">
          <ContactCard
            icon={<Phone className="h-5 w-5 text-green-500" />}
            title="Телефон"
            lines={['+380 (97) 772 78 78']}
          />
          <ContactCard
            icon={<Mail className="h-5 w-5 text-green-600" />}
            title="Email"
            lines={['info@strongauto.com.ua']}
          />
          <ContactCard
            icon={<MapPin className="h-5 w-5 text-red-500" />}
            title="Адреса"
            lines={['м. Рівне', 'м. Тернопіль']}
          />
          <ContactCard
            icon={<Clock className="h-5 w-5 text-orange-500" />}
            title="Графік роботи"
            lines={['Пн-Пт: 09:00 - 18:00', 'Сб: 10:00 - 15:00', 'Нд: Вихідний']}
          />

          {/* Map Placeholder */}
          <div className="overflow-hidden rounded-lg border border-border bg-white">
            <div className="flex h-56 items-center justify-center bg-background">
              <div className="text-center">
                <MapPin className="mx-auto h-8 w-8 text-fg-subtle" />
                <p className="mt-2 text-sm text-fg-muted">Карта</p>
              </div>
            </div>
          </div>
        </div>

        {/* Lead Form */}
        <div>
          <div className="rounded-lg border border-border bg-white p-6 sm:p-8">
            <h2 className="font-display font-bold text-fg" style={{ fontSize: 22 }}>Залиште заявку</h2>
            <p className="mt-2 text-sm text-fg-muted">
              Заповніть форму, і наш менеджер зв&#39;яжеться з вами найближчим часом.
            </p>
            <div className="mt-6">
              {formSubmitted ? (
                <div className="py-8 text-center">
                  <p className="text-lg font-bold text-green-600">
                    Дякуємо! Вашу заявку отримано.
                  </p>
                  <p className="mt-2 text-fg-muted">
                    Наш менеджер зв&#39;яжеться з вами найближчим часом.
                  </p>
                </div>
              ) : (
                <LeadForm
                  leadType="CONTACT_FORM"
                  onSuccess={() => setFormSubmitted(true)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function ContactCard({
  icon,
  title,
  lines,
}: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
}) {
  return (
    <div className="flex gap-4 rounded-lg border border-border bg-white p-5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <h3 className="text-sm font-bold text-fg">{title}</h3>
        {lines.map((line, i) => (
          <p key={i} className="mt-1 text-sm text-fg-muted">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
