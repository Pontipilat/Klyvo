import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { KlyvoCard, KlyvoIconButton, KlyvoScreen, ScreenHeader } from '../../src/components/ui';
import { useTranslation } from '../../src/i18n';
import { colors, fonts, spacing } from '../../src/theme';

type DocKey = 'privacy' | 'terms' | 'storage' | 'content';

interface Doc {
  title: string;
  sections: { heading: string; body: string }[];
}

/**
 * Тексты-черновики: они закрывают пустые пункты меню и описывают реальное поведение
 * приложения. Перед публикацией в App Store и Google Play их обязан проверить юрист.
 */
const documents: Record<'ru' | 'en', Record<DocKey, Doc>> = {
  ru: {
    privacy: {
      title: 'Политика конфиденциальности',
      sections: [
        {
          heading: 'Какие данные мы собираем',
          body: 'Email и отображаемое имя при регистрации. Текст ваших промптов, изображения, которые вы загружаете как первый и последний кадр, и созданные видео. Историю операций с кредитами. При гостевом входе — только анонимный идентификатор устройства, без email.',
        },
        {
          heading: 'Зачем',
          body: 'Чтобы создавать видео по вашему запросу, показывать вашу библиотеку, считать баланс кредитов и восстанавливать доступ к аккаунту.',
        },
        {
          heading: 'Кому передаются данные',
          body: 'Текст промпта и загруженные кадры отправляются провайдеру генерации видео (BytePlus ModelArk) и, при использовании улучшения промпта, языковой модели. Мы не продаём ваши данные и не передаём их рекламным сетям.',
        },
        {
          heading: 'Доступ к фото',
          body: 'Приложение запрашивает доступ к галерее только в двух случаях: когда вы сами выбираете изображение как кадр и когда сохраняете готовое видео. Библиотека фотографий не сканируется.',
        },
        {
          heading: 'Ваши права',
          body: 'Вы можете в любой момент удалить отдельное видео или весь аккаунт целиком: Профиль → Удалить аккаунт. Удаление аккаунта необратимо стирает профиль, видео, историю операций и остаток кредитов.',
        },
      ],
    },
    terms: {
      title: 'Условия использования',
      sections: [
        {
          heading: 'Что такое Klyvo',
          body: 'Сервис генерации коротких видео по текстовому описанию и изображениям с помощью моделей искусственного интеллекта. Результат носит вероятностный характер: одинаковый запрос может дать разные видео.',
        },
        {
          heading: 'Кредиты',
          body: 'Генерация оплачивается кредитами. Стоимость зависит от длительности, разрешения, наличия звука, режима и количества вариантов — полная разбивка показана на экране создания до нажатия кнопки. Кредиты списываются после успешной генерации. Если генерация не удалась или была отменена, резерв возвращается на баланс. Кредиты не являются денежным средством и не подлежат обмену на деньги.',
        },
        {
          heading: 'Ваш контент',
          body: 'Права на созданные вами видео остаются за вами. Публикуя видео в общую ленту, вы разрешаете Klyvo показывать его другим пользователям на условиях, которые сами выбираете в окне публикации. Убрать видео из ленты можно в любой момент.',
        },
        {
          heading: 'Ограничения',
          body: 'Запрещено создавать материалы, нарушающие закон, а также контент, описанный в правилах контента. Нарушение может привести к блокировке аккаунта без возврата кредитов.',
        },
        {
          heading: 'Ответственность',
          body: 'Сервис предоставляется «как есть». Мы не гарантируем непрерывную работу сторонних моделей генерации и не отвечаем за содержание видео, созданных пользователями.',
        },
      ],
    },
    storage: {
      title: 'Хранение и удаление данных',
      sections: [
        {
          heading: 'Где хранятся видео',
          body: 'Готовые ролики и превью сохраняются на сервере Klyvo или в объектном хранилище. Ссылки на медиа выдаются только авторизованному владельцу либо для видео, опубликованных в ленту.',
        },
        {
          heading: 'Сколько хранятся',
          body: 'Видео хранится, пока вы сами его не удалите или пока существует аккаунт. Загруженные исходные кадры хранятся вместе с генерацией.',
        },
        {
          heading: 'Удаление',
          body: 'Удаление видео убирает его из ленты и из вашей библиотеки. Удаление аккаунта каскадно стирает профиль, все генерации, видео, публикации, лайки, историю операций и связанные файлы.',
        },
        {
          heading: 'Резервные копии',
          body: 'Технические резервные копии базы могут храниться ограниченное время после удаления и затем перезаписываются.',
        },
      ],
    },
    content: {
      title: 'Правила контента',
      sections: [
        {
          heading: 'Нельзя создавать',
          body: 'Сексуализированный контент, особенно с участием несовершеннолетних. Реалистичные сцены насилия и жестокости. Материалы, разжигающие ненависть. Инструкции по причинению вреда. Дипфейки реальных людей без их согласия.',
        },
        {
          heading: 'Нельзя публиковать',
          body: 'Чужие работы, выдаваемые за свои. Обман, мошеннические схемы, спам. Материалы, нарушающие авторские права.',
        },
        {
          heading: 'Модерация',
          body: 'Промпты проверяются автоматически перед отправкой в модель. На любое видео в ленте можно пожаловаться долгим нажатием на карточку. Жалобы просматриваются вручную.',
        },
        {
          heading: 'Возрастное ограничение',
          body: 'Сервис предназначен для пользователей от 16 лет и старше.',
        },
      ],
    },
  },
  en: {
    privacy: {
      title: 'Privacy policy',
      sections: [
        {
          heading: 'What we collect',
          body: 'Your email and display name at sign-up. The text of your prompts, images you upload as a first or last frame, and the videos you generate. Your credit transaction history. For guest accounts we store only an anonymous device identifier, with no email.',
        },
        {
          heading: 'Why',
          body: 'To generate the videos you ask for, show your library, keep your credit balance correct and restore access to your account.',
        },
        {
          heading: 'Who receives your data',
          body: 'Prompt text and uploaded frames are sent to the video generation provider (BytePlus ModelArk) and, when you use prompt enhancement, to a language model. We do not sell your data and do not share it with ad networks.',
        },
        {
          heading: 'Photo access',
          body: 'The app asks for gallery access in two cases only: when you pick an image as a frame, and when you save a finished video. Your photo library is never scanned.',
        },
        {
          heading: 'Your rights',
          body: 'You can delete an individual video or your whole account at any time: Profile → Delete account. Deleting the account permanently erases your profile, videos, transaction history and remaining credits.',
        },
      ],
    },
    terms: {
      title: 'Terms of use',
      sections: [
        {
          heading: 'What Klyvo is',
          body: 'A service that generates short videos from a text description and images using AI models. Results are probabilistic: the same prompt can produce different videos.',
        },
        {
          heading: 'Credits',
          body: 'Generation is paid for with credits. The price depends on length, resolution, audio, mode and the number of variants — the full breakdown is shown on the create screen before you tap the button. Credits are charged after a successful generation. If a generation fails or is canceled, the reserved amount returns to your balance. Credits are not money and cannot be exchanged for money.',
        },
        {
          heading: 'Your content',
          body: 'You keep the rights to the videos you create. By publishing a video to the shared feed you allow Klyvo to show it to other users under the settings you choose in the publish dialog. You can remove it from the feed at any time.',
        },
        {
          heading: 'Restrictions',
          body: 'Creating unlawful material, or anything covered by the content rules, is prohibited. Violations can lead to account suspension without a credit refund.',
        },
        {
          heading: 'Liability',
          body: 'The service is provided "as is". We do not guarantee uninterrupted operation of third-party generation models and are not responsible for the content of user-generated videos.',
        },
      ],
    },
    storage: {
      title: 'Data storage and deletion',
      sections: [
        {
          heading: 'Where videos live',
          body: 'Finished clips and previews are stored on the Klyvo server or in object storage. Media links are issued only to the authenticated owner, or for videos published to the feed.',
        },
        {
          heading: 'How long',
          body: 'A video is kept until you delete it or until the account exists. Uploaded source frames are stored alongside the generation.',
        },
        {
          heading: 'Deletion',
          body: 'Deleting a video removes it from the feed and from your library. Deleting your account cascades through the profile, every generation, video, publication, like, transaction record and the related files.',
        },
        {
          heading: 'Backups',
          body: 'Technical database backups may persist for a limited period after deletion and are then overwritten.',
        },
      ],
    },
    content: {
      title: 'Content rules',
      sections: [
        {
          heading: 'Do not generate',
          body: 'Sexual content, especially involving minors. Realistic violence and gore. Hateful material. Instructions for causing harm. Deepfakes of real people without their consent.',
        },
        {
          heading: 'Do not publish',
          body: "Other people's work presented as your own. Deception, scams, spam. Anything that infringes copyright.",
        },
        {
          heading: 'Moderation',
          body: 'Prompts are checked automatically before they reach the model. Any video in the feed can be reported with a long press on its card. Reports are reviewed manually.',
        },
        { heading: 'Age rating', body: 'The service is intended for users aged 16 and over.' },
      ],
    },
  },
};

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const router = useRouter();
  const { t, language } = useTranslation();
  const pack = documents[language === 'en' ? 'en' : 'ru'];
  const key: DocKey =
    doc === 'terms' || doc === 'storage' || doc === 'content' ? doc : 'privacy';
  const content = pack[key];

  return (
    <KlyvoScreen>
      <View style={styles.top}>
        <KlyvoIconButton icon={ChevronLeft} label={t('back')} onPress={() => router.back()} />
      </View>
      <ScreenHeader title={content.title} />
      <KlyvoCard style={styles.draft}>
        <Text style={styles.draftText}>
          {language === 'en'
            ? 'Draft. This text describes how the app actually behaves and must be reviewed by a lawyer before release.'
            : 'Черновик. Текст описывает реальное поведение приложения и должен быть проверен юристом перед релизом.'}
        </Text>
      </KlyvoCard>
      {content.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.heading}>{section.heading}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </View>
      ))}
    </KlyvoScreen>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'flex-start', flexDirection: 'row' },
  draft: { backgroundColor: colors.surfaceRaised },
  draftText: { color: colors.warning, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  section: { gap: spacing.sm },
  heading: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  body: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
});
