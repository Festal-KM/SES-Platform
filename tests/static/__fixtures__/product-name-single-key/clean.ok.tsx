// 対照: 直書きなし。コメントに SES Platform と書いても数えない。
import { t, PRODUCT_NAME } from '@ses/i18n';
export const metadata = { title: t('product.name') };
export const issuer = `${PRODUCT_NAME} 運営者コンソール`;
export const Wordmark = () => <h1>{t('product.name')}</h1>;
