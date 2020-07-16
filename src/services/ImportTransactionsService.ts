import { getCustomRepository, getRepository, In } from 'typeorm';

import csvParse from 'csv-parse';
import fs from 'fs';

import Transaction from '../models/Transaction';
import Category from '../models/Category';

import TransactionsRepository from '../repositories/TransactionsRepository';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionsRepository = getRepository(Transaction);
    const categoriesRepository = getRepository(Category);

    const contactReadStream = fs.createReadStream(filePath);

    const parsers = csvParse({
      from_line: 2, // descarta a primeira linha do arquivo (o cabeçalho)
    });

    // pipe vai ler as linhas conforme elas forem disponíveis
    const parseCSV = contactReadStream.pipe(parsers);

    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map(
        (cell: string) => cell.trim(), // remove os espaços de cada célula
      );

      // se um desses dados não existir eles não serão inseridos
      if (!title || !type || !value) return;

      categories.push(category);

      transactions.push({ title, type, value, category });
    });

    // verifica se o parseCSV emitiu um evento chamado 'end'
    await new Promise(resolve => parseCSV.on('end', resolve));

    // mapeia as categorias no banco de dados
    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories), // o método In verifica de uma vez só se as categorias que estão sendo passadas aqui existem no banco de dados
      },
    });

    // pega somente o título da categoria
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    // retorna todas as categorias que não incluem 'category' em 'existentCategoriesTitles'
    // faz outro filter para remover as categorias duplicadas do arquivo csv,
    // procurando um index em que o value seja igual.
    // self é o array de categorias
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    await categoriesRepository.save(newCategories);

    // junta as categorias novas com as existentes
    const finalCategories = [...newCategories, ...existentCategories];

    const createdTransactions = transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: finalCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await transactionsRepository.save(createdTransactions);

    await fs.promises.unlink(filePath); // exclui o arquivo

    return createdTransactions;
  }
}

export default ImportTransactionsService;
